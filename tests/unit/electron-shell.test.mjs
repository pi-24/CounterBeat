import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { windowOptions, isWindowToggle, START_PAGE, APP_URL } = createRequire(import.meta.url)('../../electron/windowConfig.js');
import { getPlatform, applyPlatform, setDesktopWindowed } from '../../src/platform/platform.js';
import { Settings } from '../../src/game/Settings.js';

test('desktop window opens fullscreen with no frame or menu chrome', () => {
    const o = windowOptions();
    assert.equal(o.fullscreen, true);
    assert.equal(o.frame, true);
    assert.equal(o.autoHideMenuBar, true);
    assert.equal(o.webPreferences.contextIsolation, true);
    assert.equal(o.webPreferences.nodeIntegration, false);
    assert.equal(START_PAGE, 'game.html');
    assert.equal(windowOptions({ windowed: true }).fullscreen, false);
    assert.equal(windowOptions({ windowed: true }).frame, true);
    assert.equal(APP_URL, 'app://counterbeat');
});

test('Alt+Enter toggles windowed mode', () => {
    assert.equal(isWindowToggle({ type: 'keyDown', alt: true, key: 'Enter' }), true);
    assert.equal(isWindowToggle({ type: 'keyDown', alt: false, key: 'Enter' }), false);
    assert.equal(isWindowToggle({ type: 'keyUp', alt: true, key: 'Enter' }), false);
});

test('platform flag comes from the preload bridge and hides web chrome', () => {
    assert.equal(getPlatform({}), 'web');
    const calls = [];
    const win = {
        counterbeatDesktop: { platform: 'desktop', setWindowed: (v) => calls.push(v) },
        document: { documentElement: { dataset: {}, classList: { add(c) { this.c = c; } } } },
    };
    assert.equal(applyPlatform(win), 'desktop');
    assert.equal(win.document.documentElement.dataset.platform, 'desktop');
    assert.equal(win.document.documentElement.classList.c, 'is-desktop');
    setDesktopWindowed(true, win);
    assert.deepEqual(calls, [true]);
    const web = { document: { documentElement: { dataset: {}, classList: { add() { throw new Error('no'); } } } } };
    assert.equal(applyPlatform(web), 'web');
});

test('CSS hides header, guest banner under .is-desktop; main/preload wired', () => {
    const css = readFileSync('src/styles/game.css', 'utf8');
    assert.match(css, /\.is-desktop \.site-header/);
    assert.match(css, /\.is-desktop \.notice/);
    assert.match(readFileSync('electron/preload.js', 'utf8'), /contextBridge/);
    assert.match(readFileSync('electron/main.js', 'utf8'), /protocol.handle/);
    assert.doesNotMatch(readFileSync('electron/main.js', 'utf8'), /new BrowserWindow[\s\S]*new BrowserWindow/);
    assert.match(readFileSync('package.json', 'utf8'), /"electron:dev"/);
});

test('windowed setting persists with other settings', () => {
    const mem = new Map();
    const storage = { read: (k, d) => mem.get(k) ?? d, write: (k, v) => mem.set(k, v) };
    const s = new Settings(storage);
    assert.equal(s.get('windowed'), false);
    s.update({ windowed: true });
    assert.equal(new Settings(storage).get('windowed'), true);
});
