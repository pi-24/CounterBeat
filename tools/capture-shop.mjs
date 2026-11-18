/**
 * capture-shop.mjs - screenshots and a click-through of the Shop (?atlas_scene=shop):
 * bots, a poor purchase message, a confirmed purchase, crosshairs and themes.
 * Loads the built game from `npm run preview` (port 4173) in headless Chrome over CDP.
 *
 *   npm run build && npm run preview
 *   node tools/capture-shop.mjs [outDir]          (default docs/design/t29)
 *
 * Dev tool only: the atlas scene keeps progress in memory and saves nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchPage } from './lib/cdp.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const OUT = path.resolve(process.argv[2] ?? 'docs/design/t29');
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
const click = async (selector) => {
    const ok = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`);
    if (!ok) errors.push(`missing ${selector}`);
    await sleep(300);
};
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate', { url: `${BASE}/game.html?atlas_scene=shop` });
for (let i = 0; i < 120 && !(await evaluate('window.__atlasReady === true')); i++) await sleep(250);
await sleep(600);
await shot('01-shop-bots');
console.log('balance', await text('.shop__coins'));
await click('[data-item-id="bullseye-hi-vis"]'); // 400, balance is 500: affordable
await click('[data-action="shop-buy"]');
console.log('confirm message', await text('.shop__msg'));
await shot('02-confirm');
await click('[data-action="shop-confirm"]');
console.log('after buy', await text('.shop__msg'), '| balance', await text('.shop__coins'));
await click('[data-action="shop-equip"]');
console.log('after equip', await text('.shop__msg'));
await click('[data-item-id="phantom-cyan-signal"]'); // 400, balance is now 100: too expensive
await click('[data-action="shop-buy"]');
console.log('poor message', await text('.shop__msg'));
await shot('03-not-enough-coins');
await click('[data-demo="death"]');
await sleep(500);
await shot('04-death-preview');
await click('[data-shop-tab="crosshair"]');
await shot('05-crosshairs');
await click('[data-shop-tab="theme"]');
await shot('06-themes');
await click('[data-shop-tab="skin"]');
await shot('07-skins');
await click('[data-action="shop-close"]');
console.log('shop hidden', await evaluate(`document.querySelector('.shop').hidden`));
console.log('errors', errors);
await page.close?.();
process.exit(errors.length ? 1 : 0);
