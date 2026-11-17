import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { checkApproval, isCi, isConfirmed, ask, requireCreatorApproval, APPROVAL_FLAG } from '../../tools/lib/release-guard.mjs';
import { appBuildVdf, depotBuildVdf, readSteamConfig, stageDepot, builderLayout } from '../../tools/build-depot.mjs';
import { steamcmdArgs, parseUser } from '../../tools/steam-upload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TTY = { stdinIsTTY: true, stdoutIsTTY: true, env: {} };

// ---------- the guard ----------

test('guard rejects a missing approval flag even on a terminal', () => {
    const r = checkApproval({ ...TTY, argv: [] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /i-am-the-creator-approving/);
});

test('guard rejects non-interactive stdin or stdout', () => {
    for (const t of [{ stdinIsTTY: false, stdoutIsTTY: true }, { stdinIsTTY: true, stdoutIsTTY: false }, { stdinIsTTY: undefined, stdoutIsTTY: undefined }]) {
        const r = checkApproval({ argv: [APPROVAL_FLAG], env: {}, ...t });
        assert.equal(r.ok, false);
        assert.match(r.reason, /TTY/);
    }
});

test('guard rejects CI even with the flag and a terminal', () => {
    for (const env of [{ CI: 'true' }, { CI: '1' }, { GITHUB_ACTIONS: 'true' }, { JENKINS_URL: 'http://x' }]) {
        const r = checkApproval({ argv: [APPROVAL_FLAG], ...TTY, env });
        assert.equal(r.ok, false, JSON.stringify(env));
        assert.match(r.reason, /CI/);
    }
    assert.equal(isCi({ CI: 'false' }), false);
    assert.equal(isCi({ CI: '0' }), false);
});

test('guard passes its pre-checks only with flag + terminal + no CI', () => {
    assert.deepEqual(checkApproval({ argv: ['x', APPROVAL_FLAG], ...TTY }), { ok: true });
});

test('only the exact confirmation phrase confirms', () => {
    assert.equal(isConfirmed('UPLOAD'), true);
    assert.equal(isConfirmed(' UPLOAD \n'), true);
    for (const a of ['', 'y', 'yes', 'upload', 'UPLOADS', undefined, null]) assert.equal(isConfirmed(a), false, String(a));
});

test('steam-upload.mjs exits non-zero when run non-interactively (with and without the flag)', () => {
    for (const args of [[], [APPROVAL_FLAG], [APPROVAL_FLAG, '--steam-user=someone']]) {
        const r = spawnSync(process.execPath, ['tools/steam-upload.mjs', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20000 });
        assert.notEqual(r.status, 0, args.join(' '));
        assert.match(r.stderr, /REFUSED/);
    }
});

test('steam-upload.mjs refuses under CI even if a terminal were present', () => {
    const r = spawnSync(process.execPath, ['tools/steam-upload.mjs', APPROVAL_FLAG], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, CI: 'true' }, timeout: 20000,
    });
    assert.notEqual(r.status, 0);
});

// ---------- no unguarded upload anywhere ----------

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'release' || name === 'dist' || name === '.git') continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

test('only tools/steam-upload.mjs mentions running steamcmd, and it is behind the guard', () => {
    const scanned = walk(ROOT).filter((p) => /\.(mjs|js|cjs|py|sh|bat|cmd|ps1|json|ya?ml|md)$/.test(p) && !/package-lock\.json$/.test(p)
        && !rel(p).startsWith('art-src/') && !rel(p).startsWith('docs/'));
    const allowed = new Set(['tools/steam-upload.mjs', 'tests/unit/release-guard.test.mjs']);
    for (const f of scanned) {
        if (allowed.has(rel(f))) continue;
        const src = readFileSync(f, 'utf8');
        assert.doesNotMatch(src, /run_app_build/, `${rel(f)} must not reference run_app_build`);
        assert.doesNotMatch(src, /['"`]steam['"`]\s*\+\s*['"`]cmd/i, `${rel(f)} must not build the steamcmd name by concatenation`);
        assert.doesNotMatch(src, /(spawn|exec)\w*\s*\(\s*[^)]*steamcmd/i, `${rel(f)} must not launch steamcmd`);
        assert.doesNotMatch(src, /butler\s+push|app_build.*\+login|\+login\s/i, `${rel(f)} must not upload`);
    }
});

test('package.json scripts never call steamcmd directly', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
        assert.doesNotMatch(cmd, /steamcmd|run_app_build/i, name);
        if (/steam-upload/.test(cmd)) assert.doesNotMatch(cmd, /--i-am-the-creator-approving/, `${name} must not pre-supply the approval flag`);
    }
    assert.match(pkg.scripts.depot, /build-depot\.mjs/);
});

test('steam-upload.mjs spawns steamcmd exactly once, after the approval guard resolves', () => {
    const src = readFileSync(path.join(ROOT, 'tools', 'steam-upload.mjs'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const spawns = [...code.matchAll(/spawn(Sync)?\s*\(/g)];
    assert.equal(spawns.length, 1);
    const guard = code.indexOf('await requireCreatorApproval(');
    assert.ok(guard > 0, 'guard call present');
    assert.ok(guard < spawns[0].index, 'guard precedes spawn');
    assert.match(code, /from '\.\/lib\/release-guard\.mjs'/);
    // the spawn sits inside main(), which is the only place the guard is awaited
    const spawnFn = code.slice(code.lastIndexOf('async function main', spawns[0].index), spawns[0].index);
    assert.match(spawnFn, /await requireCreatorApproval/);
});

test('build-depot.mjs never spawns anything but the local electron build', () => {
    const src = readFileSync(path.join(ROOT, 'tools', 'build-depot.mjs'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /steamcmd|run_app_build|\+login/i);
    const spawns = [...code.matchAll(/spawn(Sync)?\s*\(\s*('[^']*'|"[^"]*")/g)].map((m) => m[2]);
    assert.deepEqual(spawns, ["'npm run electron:build'"]);
});

// ---------- depot content ----------

test('VDF templates use the App ID from data/steam.json and never go live on their own', () => {
    const steam = readSteamConfig();
    const cfg = JSON.parse(readFileSync(path.join(ROOT, 'data', 'steam.json'), 'utf8'));
    assert.equal(steam.appId, cfg.appId);
    assert.equal(steam.depotId, cfg.appId + 1);
    const app = appBuildVdf(steam);
    assert.match(app, new RegExp(`"AppID" "${cfg.appId}"`));
    assert.match(app, new RegExp(`"${steam.depotId}" "depot_build_${steam.depotId}.vdf"`));
    assert.match(app, /"SetLive" ""/);
    assert.match(depotBuildVdf(steam), new RegExp(`"DepotID" "${steam.depotId}"`));
});

test('readSteamConfig rejects a bad App ID', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cb-steam-'));
    const f = path.join(dir, 'steam.json');
    writeFileSync(f, JSON.stringify({ appId: 'abc' }));
    assert.throws(() => readSteamConfig(f), /appId/);
    writeFileSync(f, JSON.stringify({ appId: 1234567 }));
    assert.deepEqual(readSteamConfig(f), { appId: 1234567, depotId: 1234568, placeholder: false });
    writeFileSync(f, JSON.stringify({ appId: 1234567, depotId: 7654321 }));
    assert.equal(readSteamConfig(f).depotId, 7654321);
    writeFileSync(f, JSON.stringify({ appId: 1234567, depotId: 'x' }));
    assert.throws(() => readSteamConfig(f), /depotId/);
});

test('stageDepot copies the unpacked build and writes both VDFs; fails without a build', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cb-depot-'));
    mkdirSync(path.join(root, 'data'), { recursive: true });
    writeFileSync(path.join(root, 'data', 'steam.json'), JSON.stringify({ appId: 4242 }));
    writeFileSync(path.join(root, 'electron-builder.json'), JSON.stringify({ productName: 'CounterBeat', directories: { output: 'release' } }));
    assert.throws(() => stageDepot({ root }), /not found/);
    mkdirSync(path.join(root, 'release', 'win-unpacked', 'resources'), { recursive: true });
    writeFileSync(path.join(root, 'release', 'win-unpacked', 'CounterBeat.exe'), 'exe');
    writeFileSync(path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar'), 'asar');
    const out = stageDepot({ root });
    assert.ok(existsSync(path.join(out.content, 'CounterBeat.exe')));
    assert.ok(existsSync(path.join(out.content, 'resources', 'app.asar')));
    assert.match(out.appVdf, /app_build_4242\.vdf$/);
    assert.match(out.depotVdf, /depot_build_4243\.vdf$/);
    assert.match(readFileSync(out.appVdf, 'utf8'), /"AppID" "4242"/);
});

test('steamcmd arguments and user parsing', () => {
    assert.deepEqual(steamcmdArgs({ user: 'u', appVdf: 'a.vdf' }), ['+login', 'u', '+run_app_build', 'a.vdf', '+quit']);
    assert.equal(parseUser(['--steam-user=bob ']), 'bob');
    assert.equal(parseUser([]), '');
});

test('docs/steam-handoff.md lists what only the creator can do', () => {
    const doc = readFileSync(path.join(ROOT, 'docs', 'steam-handoff.md'), 'utf8');
    for (const s of ['Steam Direct', 'tax', 'bank', 'App ID', 'S5', 'S6', 'steamcmd', '--i-am-the-creator-approving']) assert.ok(doc.includes(s), s);
});

test('builderLayout is derived from the real electron-builder.json and matches the real build output name', () => {
    const l = builderLayout();
    const cfg = JSON.parse(readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
    assert.equal(l.exe, `${cfg.productName}.exe`);
    assert.equal(l.unpacked, path.join(cfg.directories.output, 'win-unpacked'));
    assert.match(readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^release\/?$/m);
});

// ---------- the interactive prompt (success path) ----------

function fakeTerminal(lines) {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    setImmediate(() => input.write(lines));
    return { input, output };
}

test('ask resolves with the typed answer (not the empty close value)', async () => {
    assert.equal(await ask('? ', fakeTerminal('UPLOAD\n')), 'UPLOAD');
});

test('ask resolves with an empty answer when the stream ends without input', async () => {
    const t = fakeTerminal('');
    setImmediate(() => t.input.end());
    assert.equal(await ask('? ', t), '');
});

const APPROVED = { argv: [APPROVAL_FLAG], env: {}, stdinIsTTY: true, stdoutIsTTY: true };

test('requireCreatorApproval proceeds when the exact phrase is typed through the real prompt', async () => {
    const codes = [];
    const t = fakeTerminal('UPLOAD\n');
    const r = await requireCreatorApproval('test action', { ...APPROVED, ask: (q) => ask(q, t), exit: (c) => codes.push(c) });
    assert.equal(r, true);
    assert.deepEqual(codes, []);
});

test('requireCreatorApproval exits 3 on a wrong answer, 2 without the flag, 4 on a failed preflight (and never asks then)', async () => {
    const codes = [];
    const exit = (c) => codes.push(c);
    let asked = 0;
    const askFn = async () => { asked++; return 'nope'; };
    await requireCreatorApproval('a', { ...APPROVED, ask: askFn, exit });
    await requireCreatorApproval('a', { ...APPROVED, argv: [], ask: askFn, exit });
    assert.equal(asked, 1);
    await requireCreatorApproval('a', { ...APPROVED, preflight: () => 'App ID is the placeholder', ask: askFn, exit });
    assert.equal(asked, 1, 'preflight failure must not prompt');
    assert.deepEqual(codes, [3, 2, 4]);
});
