/**
 * make-target-skins.mjs
 *
 * Generates the recoloured placeholder target skins (bot-hex, bot-chevron)
 * from public/images/bot-sheet.png by permuting colour channels.  Placeholders
 * only: replace them by editing data/targets.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './validate-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, body) => {
    const t = Buffer.from(type, 'ascii'); const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0); t.copy(out, 4); Buffer.from(body).copy(out, 8);
    out.writeUInt32BE(crc(Buffer.concat([t, Buffer.from(body)])), 8 + body.length); return out;
};
export function encodePng({ width, height, data }) { // RGBA, filter 0
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', [])]);
}

const src = decodePng(readFileSync(resolve(root, 'public/images/bot-sheet.png')));
const toRgba = (img) => {
    if (img.channels === 4) return img.data;
    const out = new Uint8Array(img.width * img.height * 4);
    for (let i = 0; i < img.width * img.height; i++) {
        const o = i * img.channels;
        const rgb = img.channels >= 3 ? [img.data[o], img.data[o + 1], img.data[o + 2]] : [img.data[o], img.data[o], img.data[o]];
        out.set([...rgb, img.channels === 2 ? img.data[o + 1] : 255], i * 4);
    }
    return out;
};
const rgba = toRgba(src);
const palette = JSON.parse(readFileSync(resolve(root, 'data/themes.json'), 'utf8')).palette.colours
    .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
/** Pulls a colour toward its nearest palette colour until it is within `max` (0..1) of it. */
function pullToPalette(rgb, max = 0.15) {
    let best = palette[0]; let bd = Infinity;
    for (const c of palette) { const d = Math.hypot(rgb[0] - c[0], rgb[1] - c[1], rgb[2] - c[2]) / 441.67; if (d < bd) { bd = d; best = c; } }
    if (bd <= max) return rgb;
    const k = max / bd;
    return rgb.map((v, i) => Math.round(best[i] + (v - best[i]) * k));
}
const skins = { 'bot-hex': [2, 1, 0], 'bot-chevron': [1, 2, 0] };
for (const [name, perm] of Object.entries(skins)) {
    const out = new Uint8Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
        const rgb = pullToPalette([rgba[i + perm[0]], rgba[i + perm[1]], rgba[i + perm[2]]]);
        out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = rgba[i + 3];
    }
    writeFileSync(resolve(root, `public/images/${name}-sheet.png`), encodePng({ width: src.width, height: src.height, data: out }));
    console.log('wrote', name);
}
