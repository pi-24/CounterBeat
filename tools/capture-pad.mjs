/**
 * capture-pad.mjs - runtime evidence for the gamepad UI.  Loads the built game
 * (served from dist/ by `npm run preview`, port 4173) in headless Chrome over the
 * DevTools protocol, replaces navigator.getGamepads with a scripted Xbox pad, drives
 * the menus with it and screenshots the result.  No npm dependency: it speaks CDP
 * through Node's global WebSocket.
 *
 *   npm run preview
 *   CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe" node tools/capture-pad.mjs [outDir] [tag]
 *
 * Dev tool only: it never ships and never touches saved progress.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(process.argv[2] ?? 'docs/pad-evidence');
const TAG = process.argv[3] ?? 'on';
const PORT = 9333 + Math.floor(Math.random() * 500);
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), 'cb-pad-'));
const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
            const page = list.find((t) => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error('chrome did not start');
}
const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
const consoleErrors = [];
ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(`${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((resolve) => {
    const myId = ++id;
    waiting.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
});
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => {
    const { result } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'));
    console.log('wrote', name);
};

// A scripted standard-layout pad: window.__pad.set({ down:[..], axes:[..] }).
const FAKE_PAD = `
(() => {
    const state = { down: new Set(), axes: [0, 0, 0, 0] };
    window.__pad = {
        set({ down = [], axes = [0, 0, 0, 0] }) { state.down = new Set(down); state.axes = axes; },
        async tap(button, ms = 120) { state.down.add(button); await new Promise((r) => setTimeout(r, ms)); state.down.delete(button); await new Promise((r) => setTimeout(r, 90)); },
    };
    const make = () => ({
        id: 'Xbox 360 Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
        axes: state.axes.slice(),
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: state.down.has(i), touched: state.down.has(i), value: state.down.has(i) ? 1 : 0 })),
    });
    navigator.getGamepads = () => [make(), null, null, null];
    window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: make() })), 300));
})();`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setFocusEmulationEnabled', { enabled: true }); // headless pages are otherwise never :focus
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_PAD });

async function load(query) {
    await send('Page.navigate', { url: `${BASE}/game.html${query}` });
    for (let i = 0; i < 120; i++) { if (await evaluate('window.__atlasReady === true')) break; await sleep(250); }
    await sleep(800);
}
const focused = () => evaluate(`(() => { const e = document.activeElement; return e && e !== document.body ? (e.dataset?.action || e.id || e.className || e.tagName) + ' | ' + (e.textContent || '').trim().slice(0, 40) : 'none'; })()`);

// 1. Menu driven by the pad: down x2, right x2.
await load('?atlas_scene=title');
await evaluate('window.__pad.tap(13)');
await sleep(300);
const trail = [await focused()];
for (const b of [13, 13, 15, 15]) { await evaluate(`window.__pad.tap(${b})`); trail.push(await focused()); }
console.log('menu focus trail:', trail);
await shot(`${TAG}-1-menu-pad-focus`);
await evaluate('window.__pad.set({ axes: [0, 0.9, 0, 0] })'); await sleep(700);
await evaluate('window.__pad.set({ axes: [0, 0, 0, 0] })');
console.log('after stick-down hold:', await focused());
await shot(`${TAG}-2-menu-stick-repeat`);

// 2. Settings, Gamepad group scrolled into view.
await load('?atlas_scene=settings');
await evaluate('window.__pad.tap(15)');
await evaluate(`(() => { const l = [...document.querySelectorAll('legend')].find((x) => x.textContent.trim() === 'Gamepad'); l?.scrollIntoView({ block: 'start' }); return !!l; })()`);
await sleep(400);
console.log('Gamepad group present:', await evaluate(`[...document.querySelectorAll('legend')].some((x) => x.textContent.trim() === 'Gamepad')`));
console.log('notices:', await evaluate(`[...document.querySelectorAll('.settings__note')].map((n) => n.textContent.trim().slice(0, 90))`));
await shot(`${TAG}-3-settings-gamepad-group`);

// 3. Pad controls rail on the menu (device flips to pad once a button is touched).
await load('?atlas_scene=title');
await evaluate('window.__pad.tap(15)');
await sleep(300);
console.log('body data-input:', await evaluate('document.body.dataset.input'), '| pad list rows:', await evaluate(`document.getElementById('padControlsList')?.children.length`));
await evaluate(`document.getElementById('padControlsList')?.scrollIntoView({ block: 'center' })`);
await shot(`${TAG}-4-controls-rail`);

// 4. A real run started by the pad: Campaign (A), then A on the first focused chart / difficulty.
await load('?atlas_scene=title');
await evaluate('window.__pad.tap(13)');
await evaluate('window.__pad.tap(0)');
await sleep(600);
console.log('after opening Campaign, focused:', await focused());
await shot(`${TAG}-5a-campaign-pad-focus`);
for (let i = 0; i < 4 && !(await evaluate(`!!document.activeElement?.closest?.('.diff')`)); i++) await evaluate('window.__pad.tap(15)');
console.log('difficulty focused:', await focused());
await evaluate('window.__pad.tap(0, 160)');
await sleep(9000);
await shot(`${TAG}-5-play-start`);
await evaluate('window.__pad.set({ axes: [0.9, 0, 0.9, 0.3] })'); await sleep(1200);
await shot(`${TAG}-6-play-stick-held`);
await evaluate('window.__pad.set({ axes: [0, 0, 0, 0] })');
await evaluate('window.__pad.tap(9)'); // Start: pause
await sleep(400);
await shot(`${TAG}-7-play-paused`);

console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');
chrome.kill();
process.exit(0);
