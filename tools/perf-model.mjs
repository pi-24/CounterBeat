/**
 * perf-model.mjs - time-to-main-menu on a Fast-3G-class link, from real file sizes.
 * Profile: Chrome DevTools "Fast 3G" (1.6 Mbit/s down, 150 ms RTT).  Bandwidth
 * is shared, so time = request round trips on the critical chain + bytes / rate.
 *   node tools/perf-model.mjs   (needs `npm run build` first for dist/)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RATE = (1.6 * 1e6) / 8; // bytes/s
const RTT = 0.15;
const gz = (p) => gzipSync(readFileSync(p)).length;
const raw = (p) => statSync(p).size;

const dist = resolve(ROOT, 'dist');
const html = gz(resolve(dist, 'game.html'));
const files = readdirSync(resolve(dist, 'assets'));
const game = files.find((f) => /^game-.*\.js$/.test(f));
const css = files.find((f) => /^game-.*\.css$/.test(f));
// Babylon shader chunks load lazily on the first rendered frame, after the menu DOM is up: not on the critical path.
const code = html + gz(resolve(dist, 'assets', game)) + gz(resolve(dist, 'assets', css));
const audio = (name) => raw(resolve(dist, 'audio', `${name}.ogg`)); // Ogg is already compressed
const sfx = ['sfx-shot', 'sfx-skid', 'sfx-perfect', 'sfx-good', 'sfx-miss', 'sfx-ui', 'sfx-levelup', 'sfx-gameover'];

const before = { audioBytes: audio('music-menu') + sfx.reduce((n, k) => n + audio(k), 0), audioFiles: 9 };
const after = { audioBytes: 0, audioFiles: 0 }; // everything streams in after the menu is up
// Chain: html -> js/css (+ one more round trip when audio fetches must finish first).
const t = (a) => 2 * RTT + (code + a.audioBytes) / RATE + (a.audioFiles ? RTT : 0);
const tb = t(before); const ta = t(after);
console.log(JSON.stringify({
    codeKB: Math.round(code / 1024),
    before: { audioFiles: before.audioFiles, audioKB: Math.round(before.audioBytes / 1024), seconds: +tb.toFixed(2) },
    after: { audioFiles: after.audioFiles, audioKB: Math.round(after.audioBytes / 1024), seconds: +ta.toFixed(2) },
    reductionPercent: +(100 * (1 - ta / tb)).toFixed(1),
}, null, 2));
