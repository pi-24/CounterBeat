/**
 * capture-pages.mjs - screenshots of the website pages in Direction C at desktop (1280) and
 * phone (390) width, plus a horizontal-overflow check.  Loads the built site from
 * `npm run preview` (port 4173) in headless Chrome over CDP.
 *
 *   npm run build && npm run preview
 *   node tools/capture-pages.mjs [outDir]          (default docs/design/t27)
 *
 * Dev tool only: it never ships and never writes saved progress beyond a throwaway profile.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchPage } from './lib/cdp.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const OUT = path.resolve(process.argv[2] ?? 'docs/design/t27');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = ['index', 'how-to-play', 'rankings', 'profile', 'login', 'register'];
const SIZES = [['desktop', 1280, 800, false], ['phone', 390, 800, true]];

const page = await launchPage();
const errors = [];
page.listen((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const evaluate = async (expression) => (await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await page.send('Page.enable');
await page.send('Runtime.enable');

let overflow = 0;
for (const [label, width, height, mobile] of SIZES) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    for (const name of PAGES) {
        await page.send('Page.navigate', { url: `${BASE}/${name}.html` });
        await sleep(2500);
        const dims = await evaluate('({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight })');
        const bad = dims.sw > dims.cw + 1;
        if (bad) overflow += 1;
        console.log(`${label} ${name}: scrollWidth ${dims.sw} / ${dims.cw}${bad ? '  <-- HORIZONTAL SCROLL' : ''}`);
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(dims.h, 3000), deviceScaleFactor: 1, mobile });
        await sleep(300);
        const { result } = await page.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(path.join(OUT, `${name}-${label}.png`), Buffer.from(result.data, 'base64'));
        await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    }
}
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
page.close();
process.exit(overflow || errors.length ? 1 : 0);
