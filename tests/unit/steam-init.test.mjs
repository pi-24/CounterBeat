import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { createSteamService, SteamService, API_METHODS } = require('../../electron/steam/SteamService.js');
const { NullSteamService } = require('../../electron/steam/NullSteamService.js');

const fakeModule = (calls = []) => ({
    init: (id) => { calls.push(['init', id]); return {
        localplayer: { getName: () => 'Ann' },
        achievement: { activate: () => true, isActivated: () => false } }; },
    electronEnableSteamOverlay: () => calls.push(['overlay']),
});

test('steam.json has a valid appId', () => {
    const cfg = JSON.parse(readFileSync(new URL('../../data/steam.json', import.meta.url)));
    assert.ok(Number.isInteger(cfg.appId) && cfg.appId > 0);
});

test('init success uses appId and enables overlay', () => {
    const calls = [];
    const s = createSteamService({ config: { appId: 480 }, loadModule: () => fakeModule(calls) });
    assert.ok(s instanceof SteamService);
    assert.deepEqual(calls, [['init', 480], ['overlay']]);
    assert.equal(s.getPlayerName(), 'Ann');
    assert.equal(s.getStatus().achievements, true);
});

test('missing module falls back to null with one warning', () => {
    const warns = [];
    const s = createSteamService({ config: { appId: 480 }, loadModule: () => { throw new Error('no module'); }, logger: { warn: (m) => warns.push(m) } });
    assert.ok(s instanceof NullSteamService);
    assert.equal(warns.length, 1);
    assert.equal(s.getStatus().available, false);
    assert.equal(s.unlockAchievement('X'), false);
});

test('init throwing (Steam not running) falls back without crashing', () => {
    const warns = [];
    const s = createSteamService({ config: { appId: 480 }, loadModule: () => ({ init() { throw new Error('Steam not running'); } }), logger: { warn: (m) => warns.push(m) } });
    assert.equal(s.available, false);
    assert.equal(warns.length, 1);
});

test('bad appId falls back', () => {
    const s = createSteamService({ config: {}, loadModule: fakeModule, logger: { warn() {} } });
    assert.equal(s.available, false);
});

test('real and null services have the same API shape', () => {
    const real = createSteamService({ config: { appId: 480 }, loadModule: () => fakeModule() });
    const nul = new NullSteamService();
    for (const m of API_METHODS) {
        assert.equal(typeof real[m], 'function', m);
        assert.equal(typeof nul[m], 'function', m);
    }
    assert.deepEqual(Object.keys(real.getStatus()).sort(), Object.keys(nul.getStatus()).sort());
});

const { loadSteamConfig, steamConfigPath } = require('../../electron/steam/config.js');
const { registerSteamIpc, channel } = require('../../electron/steam/ipc.js');
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('loadSteamConfig: real file, missing file, malformed JSON', () => {
    assert.equal(loadSteamConfig({ logger: { warn() {} } }).appId, 480);
    const dir = mkdtempSync(join(tmpdir(), 'cb-'));
    const warns = [];
    assert.deepEqual(loadSteamConfig({ file: join(dir, 'none.json'), logger: { warn: (m) => warns.push(m) } }), {});
    writeFileSync(join(dir, 'bad.json'), '{oops');
    assert.deepEqual(loadSteamConfig({ file: join(dir, 'bad.json'), logger: { warn: (m) => warns.push(m) } }), {});
    assert.equal(warns.length, 2);
    writeFileSync(join(dir, 'str.json'), '"x"');
    assert.deepEqual(loadSteamConfig({ file: join(dir, 'str.json') }), {});
    assert.ok(steamConfigPath().endsWith(join('data', 'steam.json')));
});

test('non-integer appId falls back', () => {
    assert.equal(createSteamService({ config: { appId: 'abc' }, loadModule: fakeModule, logger: { warn() {} } }).available, false);
    assert.equal(createSteamService({ config: { appId: 1.5 }, loadModule: fakeModule, logger: { warn() {} } }).available, false);
});

test('overlay is enabled once via electronEnableSteamOverlay, and can be disabled', () => {
    let calls = 0;
    const mod = () => ({ ...fakeModule(), electronEnableSteamOverlay: () => { calls++; } });
    createSteamService({ config: { appId: 480 }, loadModule: mod });
    assert.equal(calls, 1);
    createSteamService({ config: { appId: 480 }, loadModule: mod, enableOverlay: false });
    assert.equal(calls, 1);
});

test('missing module warns once with a packaging hint', () => {
    const warns = [];
    const s = createSteamService({ config: { appId: 480 }, loadModule: () => { throw Object.assign(new Error('nope'), { code: 'MODULE_NOT_FOUND' }); }, logger: { warn: (m) => warns.push(m) } });
    assert.equal(s.available, false);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /module missing/);
});

test('IPC exposes every API method and the preload bridge matches API_METHODS', async () => {
    const handlers = {};
    registerSteamIpc({ handle: (c, fn) => { handlers[c] = fn; } }, new NullSteamService('x'));
    assert.deepEqual(Object.keys(handlers).sort(), API_METHODS.map(channel).sort());
    assert.equal((await handlers[channel('getStatus')]({})).available, false);
    assert.equal(await handlers[channel('unlockAchievement')]({}, 'A'), false);
    assert.ok(!API_METHODS.includes('shutdown') && !API_METHODS.includes('release'));
    // Execute the real preload against a fake electron and compare the exposed bridge at runtime.
    const preload = readFileSync(new URL('../../electron/preload.js', import.meta.url), 'utf8');
    let exposed; const invoked = [];
    const fakeElectron = { contextBridge: { exposeInMainWorld: (_n, api) => { exposed = api; } }, ipcRenderer: { invoke: (c) => { invoked.push(c); }, send() {}, on() {} } };
    new Function('require', preload)((m) => (m === 'electron' ? fakeElectron : null));
    assert.deepEqual(Object.keys(exposed.steam).sort(), [...API_METHODS].sort());
    exposed.steam.getStatus();
    assert.deepEqual(invoked, [channel('getStatus')]);
});

test('real service status reflects capability; cloud false; shutdown safe', () => {
    const s = createSteamService({ config: { appId: 480 }, loadModule: () => fakeModule() });
    assert.equal(s.getStatus().cloud, false);
    assert.equal(s.getStatus().available, true);
    s.release();
    assert.equal(s.getPlayerName(), null);
    assert.equal(s.getStatus().available, false);
});

/** Finds the platform's native binding without hard-coding a prebuild filename. */
function findBinding() {
    const root = dirname(require.resolve('steamworks.js/package.json'));
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const wanted = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`;
    const nodes = walk(join(root, 'dist')).filter((f) => f.endsWith('.node') && f.includes(wanted));
    for (const f of nodes) { try { return require(f); } catch { /* wrong ABI/libs: try next */ } }
    return null;
}

let realMod = null; let realBinding = null;
try { realMod = require('steamworks.js'); realBinding = findBinding(); } catch { /* optional dependency or prebuild absent */ }
const hasReal = !!(realMod && realBinding) || process.env.CB_RELEASE === '1';

test('installed steamworks.js exposes the exact surface SteamService uses', { skip: !hasReal && 'steamworks.js / native binding not available (optional dependency)' }, () => {
    const mod = require('steamworks.js');
    assert.equal(typeof mod.init, 'function');
    assert.equal(typeof mod.electronEnableSteamOverlay, 'function');
    const used = { localplayer: ['getName'], achievement: ['activate', 'isActivated'] };
    const binding = realBinding || findBinding();
    assert.ok(binding, 'native binding for this platform loads');
    {
        for (const [ns, fns] of Object.entries(used)) {
            assert.ok(binding[ns], `native binding has namespace ${ns}`);
            for (const f of fns) assert.equal(typeof binding[ns][f], 'function', `${ns}.${f}`);
        }
    }
    // The behaviour-test fake must expose exactly the keys the wrapper uses (and the real module has).
    const fakeClient = fakeModule().init(480);
    assert.deepEqual(Object.keys(fakeClient.achievement).sort(), [...used.achievement].sort());
    for (const k of Object.keys(fakeClient.localplayer)) assert.ok(used.localplayer.includes(k), k);
    assert.deepEqual(Object.keys(fakeModule()).sort(), ['electronEnableSteamOverlay', 'init']);
});

test('IPC rejects achievement names outside the configured list', async () => {
    const handlers = {}; const seen = [];
    registerSteamIpc({ handle: (c, fn) => { handlers[c] = fn; } }, { unlockAchievement: (n) => { seen.push(n); return true; }, isAchievementUnlocked: () => false }, { achievements: ['A'] });
    assert.equal(await handlers[channel('unlockAchievement')]({}, 'A'), true);
    assert.equal(await handlers[channel('unlockAchievement')]({}, 'EVIL'), false);
    assert.deepEqual(seen, ['A']);
});

test('forceOff falls back with one warning even when init would succeed', () => {
    const warns = [];
    const s = createSteamService({ config: { appId: 480 }, loadModule: () => fakeModule(), forceOff: true, logger: { warn: (m) => warns.push(m) } });
    assert.equal(s.available, false);
    assert.equal(warns.length, 1);
});

test('placeholder App ID warns once at startup; release check rejects it', () => {
    const { releaseProblems } = require('../../electron/steam/config.js');
    const warns = [];
    createSteamService({ config: { appId: 480, appIdIsPlaceholder: true }, loadModule: () => fakeModule(), logger: { warn: (m) => warns.push(m) } });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /placeholder/);
    assert.ok(releaseProblems({ appId: 480 }).length > 0);
    assert.ok(releaseProblems({ appId: 12345, appIdIsPlaceholder: true }).length > 0);
    assert.deepEqual(releaseProblems({ appId: 12345 }), []);
    // Packaging gate: CB_RELEASE=1 npm test fails while data/steam.json still holds the placeholder.
    if (process.env.CB_RELEASE === '1') assert.deepEqual(releaseProblems(JSON.parse(readFileSync('data/steam.json', 'utf8'))), []);
});

test('electron-builder unpacks steamworks.js natives', () => {
    const b = JSON.parse(readFileSync('electron-builder.json', 'utf8'));
    for (const ext of ['node', 'dll']) assert.ok(b.asarUnpack.some((g) => g.includes('steamworks.js') && g.endsWith('.' + ext)), ext);
});

test('overlay preconditions: no disabled GPU, transparent or offscreen windows', () => {
    for (const f of ['electron/main.js', 'electron/windowConfig.js']) {
        let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
        assert.doesNotMatch(src, /disableHardwareAcceleration\s*\(/, f);
        assert.doesNotMatch(src, /transparent\s*:\s*true/, f);
        assert.doesNotMatch(src, /offscreen\s*:\s*true/, f);
    }
});
