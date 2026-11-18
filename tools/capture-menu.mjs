/**
 * capture-menu.mjs - screenshots of the Direction C shell: clean main menu, song select
 * (each difficulty, a locked track) and the Help overlay from menu and pause.  Loads the
 * built game from `npm run preview` (port 4173) in headless Chrome over CDP.
 *
 *   npm run build && npm run preview
 *   node tools/capture-menu.mjs [outDir]          (default docs/design/t25)
 *
 * Dev tool only: it never ships and never touches saved progress beyond a throwaway profile.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchPage } from './lib/cdp.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const OUT = path.resolve(process.argv[2] ?? 'docs/design/t25');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await launchPage();
const errors = [];
page.listen((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const evaluate = async (expression) => (await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => {
    const { result } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'));
    console.log('wrote', name);
};
const key = async (code, k = code) => {
    for (const type of ['keyDown', 'keyUp']) {
        await page.send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: { Enter: 13, Escape: 27, ArrowDown: 40, KeyQ: 81, KeyE: 69, KeyS: 83, KeyH: 72, KeyW: 87 }[code] ?? 0 });
    }
    await sleep(250);
};
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate', { url: `${BASE}/game.html?atlas_scene=title` });
for (let i = 0; i < 120 && !(await evaluate('window.__atlasReady === true')); i++) await sleep(250);
await sleep(800);
await shot('01-main-menu');
await key('KeyS'); await key('KeyS');
await shot('02-main-menu-quickplay-focus');
await key('KeyH');
await shot('03-help-overlay-menu');
await key('Escape');
await evaluate(`document.querySelector('[data-menu-item="quickplay"]')?.click()`);
await sleep(600);
await shot('04-song-select');
for (let i = 0; i < 3; i++) { await key('KeyE'); await shot(`05-song-select-difficulty-${i + 2}`); }
for (let i = 0; i < 5; i++) await key('ArrowDown');
await shot('06-song-select-locked-track');
await key('Escape');
await evaluate(`document.querySelector('[data-menu-item="settings"]')?.click()`);
await sleep(700);
await shot('07-settings');
await evaluate(`(() => { const m = document.querySelector('.overlay--menu .menu'); m.scrollTop = m.scrollHeight; })()`);
await sleep(300);
await shot('08-settings-scrolled-bottom');
// A real run (the atlas play scene is a replay, which pauses differently): Quick Play, PLAY, then P.
await page.send('Page.navigate', { url: `${BASE}/game.html?atlas_scene=title` });
for (let i = 0; i < 120 && !(await evaluate('window.__atlasReady === true')); i++) await sleep(250);
await sleep(600);
await evaluate(`document.querySelector('[data-menu-item="quickplay"]')?.click()`);
await sleep(500);
await evaluate(`document.querySelector('[data-menu-play]')?.click()`);
await sleep(6000);
await shot('09a-run-start');
await key('KeyP');
await shot('09-pause');
await key('KeyH');
await sleep(400);
console.log('help hidden:', await evaluate(`document.getElementById('helpOverlay').hidden`), 'pause hidden:', await evaluate(`document.getElementById('pauseOverlay')?.hidden`));
await shot('10-help-overlay-pause');
console.log('console errors:', errors.length ? errors : 'none');
page.close();
