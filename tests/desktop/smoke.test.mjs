import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);


/** Runs electron and requires a CLEAN exit (code 0) on its own: a hung process (e.g. steamworks.js timers) is a defect. */
function runSmoke(electronPath, env) {
    return new Promise((resolve) => {
        const child = spawn(electronPath, ['electron/main.js'], { env });
        let stdout = ''; let stderr = ''; let done = false;
        const finish = (status) => { if (done) return; done = true; clearTimeout(t); try { child.kill(); } catch { /* already gone */ } resolve({ stdout, stderr, status }); };
        const t = setTimeout(() => finish('hung'), 55000);
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('exit', (code) => finish(code));
    });
}

async function smoke(extraEnv) {
    assert.ok(existsSync('dist/game.html'), 'run `npm run build` first');
    const env = { ...process.env, CB_SMOKE: '1', ...extraEnv };
    delete env.ELECTRON_RUN_AS_NODE;
    const r = await runSmoke(require('electron'), env);
    const line = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
    assert.ok(line, `no JSON output. stdout=${r.stdout} stderr=${r.stderr}`);
    console.log(line);
    assert.equal(r.status, 0, `electron must exit cleanly on its own (got ${r.status})`);
    return JSON.parse(line);
}

test('electron boots offline in a shown window, clicks through to the menu with no web chrome (forced Steam fallback)', { timeout: 90000 }, async () => {
    const out = await smoke({ CB_STEAM_FORCE_OFF: '1' });
    assert.equal(out.ok, true);
    assert.equal(out.steam.available, false);
    assert.equal(out.steam.achievements, false);
    assert.equal(out.steam.appId, null);
    assert.match(out.steam.warning || '', /\[steam\] disabled/);
    // AC28: no browser/web-page shell anywhere in the menu flow.
    for (const k of ['headerVisible', 'guestBannerVisible', 'footerVisible', 'stageBarVisible', 'railVisible', 'pageScrolls']) assert.equal(out[k], false, k);
    assert.equal(out.menu, true);
    assert.equal(out.platform, 'desktop');
    // AC28: starts fullscreen; the real Alt+Enter path toggles windowed and back.
    assert.equal(out.fullscreen, true);
    assert.deepEqual(out.afterAltEnter, { windowed: true, fullscreen: false });
    assert.deepEqual(out.afterSecondAltEnter, { windowed: false, fullscreen: true });
});

test('electron with the real Steam init path still reaches the menu and exits cleanly', { timeout: 90000, skip: process.env.CB_STEAM_LIVE !== '1' && 'set CB_STEAM_LIVE=1 to run against a live Steam client' }, async () => {
    const out = await smoke({});
    const cfg = JSON.parse(readFileSync('data/steam.json', 'utf8'));
    assert.equal(out.ok, true);
    assert.equal(typeof out.steam.available, 'boolean');
    if (out.steam.available) assert.equal(out.steam.appId, cfg.appId);
    else assert.match(out.steam.warning || '', /\[steam\] disabled/);
});
