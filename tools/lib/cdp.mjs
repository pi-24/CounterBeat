/**
 * cdp.mjs - tiny headless-Chrome driver over the DevTools protocol (Node 22, no dependencies).
 * Used by tools/measure-load.mjs and tools/make-tempo-fixtures.mjs.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME_PATHS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];

/** @returns {Promise<{send:(method:string, params?:object)=>Promise<any>, listen:(fn:Function)=>void, close:()=>void}>} a page session */
export async function launchPage() {
    const chrome = process.env.CHROME ?? CHROME_PATHS.find(existsSync);
    if (!chrome) throw new Error('Chrome not found (set CHROME)');
    const profile = mkdtempSync(join(tmpdir(), 'cb-cdp-'));
    const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
        '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
    const wsUrl = await new Promise((ok, bad) => {
        let buf = '';
        proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) ok(m[0]); });
        setTimeout(() => bad(new Error('chrome did not start')), 20000);
    });
    const browser = new WebSocket(wsUrl);
    await new Promise((r) => browser.addEventListener('open', r, { once: true }));
    let id = 0;
    const waiting = new Map();
    const listeners = [];
    browser.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else listeners.forEach((l) => l(m));
    });
    const raw = (method, params = {}, sessionId) => new Promise((r) => {
        const i = ++id;
        waiting.set(i, r);
        browser.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
    const { result: { targetId } } = await raw('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId } } = await raw('Target.attachToTarget', { targetId, flatten: true });
    return {
        send: (method, params) => raw(method, params, sessionId),
        listen: (fn) => listeners.push(fn),
        close: () => { try { browser.close(); } catch { /* already closed */ } proc.kill(); },
    };
}
