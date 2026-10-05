/**
 * capture-levels.mjs
 *
 * Produces the level thumbnails in website/images/levels/ by loading the real
 * game in a headless browser, starting each level, and screenshotting the
 * arena once the first bots are standing.  Run with the site served locally:
 *
 *   cd website && python3 -m http.server 8124
 *   node development/tests/capture-levels.mjs
 *
 * Requires the `playwright` npm package and a Chromium it can find.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:8124';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../website/images/levels');

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

// A throwaway account with every level unlocked, so each one can be opened.
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem('counterbeat:users', JSON.stringify([{
        id: 'u_capture', displayName: 'Capture', email: 'capture@example.com',
        passwordSalt: 'x', passwordHash: 'y', country: '', phone: '', address: '', postcode: '',
        favouriteSensitivity: '', createdAt: now,
    }]));
    localStorage.setItem('counterbeat:scores', JSON.stringify([1, 2].map((levelId) => ({
        id: `s${levelId}`, userId: 'u_capture', displayName: 'Capture', country: '', levelId,
        levelName: '', score: 1, accuracy: 1, bestCombo: 0, counterStrafes: 0, headshots: 0,
        perfect: 0, good: 0, loose: 0, missed: 0, notes: 0, completed: true, passed: true, playedAt: now,
    }))));
    localStorage.setItem('counterbeat:session', JSON.stringify({ userId: 'u_capture', startedAt: now }));
});

for (const levelId of [1, 2, 3]) {
    await page.goto(`${BASE}/game.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    await page.keyboard.press(`Digit${levelId}`);
    // Just after the first bots have stepped out, before the first note lands.
    await page.waitForTimeout({ 1: 4300, 2: 5500, 3: 6000 }[levelId]);
    // The thumbnail is the arena itself, not the interface over it.
    await page.evaluate(() => { document.getElementById('hud').hidden = true; });
    await page.waitForTimeout(80);
    const stage = await (await page.$('#stage')).boundingBox();
    const file = path.join(OUT, `level-${levelId}.png`);
    await page.screenshot({ path: file, clip: stage });
    console.log('wrote', file);
}

await browser.close();
