/**
 * capture-levels.mjs
 *
 * Produces the level thumbnails in public/images/levels/ by loading the real
 * game in a headless browser, starting a chart in each arena, and screenshotting the
 * arena once the first bots are standing.  Run with the site served locally:
 *
 *   npm run preview   (port 4173)
 *   node tools/capture-levels.mjs
 *
 * Requires the `playwright` npm package and a Chromium it can find.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/images/levels');

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

// The thumbnails are one per arena, taken from a guest run on Normal of the
// first track that uses it.
const ARENA_TRACKS = { 1: 'range', 2: 'neon', 3: 'vault' };
for (const [index, trackId] of Object.entries(ARENA_TRACKS)) {
    await page.goto(`${BASE}/game.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#menuOverlay:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.click(`.track .diff--normal >> nth=${Number(index) * 2 - 2}`);
    // Just after the first bots have stepped out, before the first note lands.
    await page.waitForTimeout({ 1: 4300, 2: 5500, 3: 6000 }[index]);
    // The thumbnail is the arena itself, not the interface over it.
    await page.evaluate(() => { document.getElementById('hud').hidden = true; });
    await page.waitForTimeout(80);
    const stage = await (await page.$('#stage')).boundingBox();
    const file = path.join(OUT, `level-${index}.png`);
    await page.screenshot({ path: file, clip: stage });
    console.log('wrote', file, `(${trackId})`);
}

await browser.close();
