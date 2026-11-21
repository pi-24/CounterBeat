/**
 * make-tempo-fixtures.mjs - decodes the SHIPPED Ogg files (public/audio/music-*.ogg) in headless
 * Chrome (Node has no Vorbis decoder) and stores a small measured fixture per track in
 * tools/fixtures/tempo/<id>.json:
 *   - energy: RMS energy of the decoded audio, one byte per 4 ms (base64, normalised to its peak)
 *   - duration: decoded length in seconds
 * tools/validate-tracks.mjs runs the beat-comb tempo fit and the tail check on these, so the
 * check is independent of the generator.  Re-run this after any change to a track's audio:
 *   node tools/make-tempo-fixtures.mjs [--write-tails]
 * --write-tails also writes each track's `tailSeconds` into data/tracks.json (see validate-tracks.mjs).
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPage } from './lib/cdp.mjs';
import { audibleEnd } from './lib/tempo.mjs';
import { TAIL_ROUND, derivedTail } from './validate-tracks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_HZ = 250;
const manifestPath = join(ROOT, 'data/tracks.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/blank') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html>'); return; }
    let body = null;
    try { body = readFileSync(join(ROOT, 'public', path)); } catch { /* 404 below */ }
    if (body) res.writeHead(200, { 'content-type': 'audio/ogg' }).end(body); else res.writeHead(404).end();
}).listen(0);
await new Promise((r) => server.once('listening', r));
const page = await launchPage();
await page.send('Page.navigate', { url: `http://localhost:${server.address().port}/blank` });
await new Promise((r) => setTimeout(r, 500));

const decode = (url) => `(async () => {
  const buf = await (await fetch(${JSON.stringify(url)})).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const a = await ctx.decodeAudioData(buf);
  const ch = a.numberOfChannels, n = a.length, mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = a.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
  const hop = Math.round(a.sampleRate / ${FIXTURE_HZ}), m = Math.floor(n / hop), e = new Float32Array(m);
  let peak = 0;
  for (let i = 0; i < m; i++) { let s = 0; for (let j = 0; j < hop; j++) { const v = mono[i * hop + j]; s += v * v; } e[i] = Math.sqrt(s / hop); if (e[i] > peak) peak = e[i]; }
  const bytes = new Uint8Array(m);
  for (let i = 0; i < m; i++) bytes[i] = Math.round((e[i] / peak) * 255);
  let bin = ''; for (let i = 0; i < m; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { duration: n / a.sampleRate, hopSec: hop / a.sampleRate, energy: btoa(bin) };
})()`;

mkdirSync(join(ROOT, 'tools/fixtures/tempo'), { recursive: true });
for (const t of manifest.tracks) {
    const url = (t.audio ?? []).find((u) => u.endsWith('.ogg'));
    const r = await page.send('Runtime.evaluate', { expression: decode(`/${url}`), awaitPromise: true, returnByValue: true });
    const v = r.result?.result?.value;
    if (!v) throw new Error(`could not decode ${url}: ${JSON.stringify(r.result)}`);
    writeFileSync(join(ROOT, `tools/fixtures/tempo/${t.id}.json`), JSON.stringify({ id: t.id, source: url, ...v }));
    const energy = Float32Array.from(Buffer.from(v.energy, 'base64'));
    const end = audibleEnd(energy, v.hopSec);
    const tail = derivedTail(t, end);
    console.log(`${t.id}: decoded ${v.duration.toFixed(3)}s, audible end ${end.toFixed(2)}s, tail ${tail}s`);
    if (process.argv.includes('--write-tails')) t.tailSeconds = tail;
}
if (process.argv.includes('--write-tails')) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`wrote tailSeconds (rounded to ${TAIL_ROUND}s)`);
}
page.close();
server.close();
process.exit(0);
