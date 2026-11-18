/**
 * build-art.mjs - reproducible art build.
 *
 * Reads the CC0 Kenney packs from art-src/kenney (gitignored; download them from
 * kenney.nl) and writes the recoloured, palette-conformant images that ship in
 * public/images.  The generated PNGs are committed, so the game and the tests do
 * not need art-src.  No network access.  Palette: data/themes.json.
 *
 *   node tools/build-art.mjs [--licences]
 *
 * Sources (licence text copied to LICENSES/kenney-<pack>.txt with --licences):
 *   particle-pack     star_04         -> spark.png
 *   prototype-textures                -> textures/floor-*.png, wall-*.png
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, hexToRgb, thumbSourceHash } from './validate-assets.mjs';
import { encodePng, toRgba, resize } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'art-src/kenney');
const OUT = resolve(ROOT, 'public/images');
const C = hexToRgb;
const NAVY0 = C('#070b1a'); const NAVY1 = C('#0f1730'); const NAVY2 = C('#1b2547');
const WHITE = C('#ffffff');

const load = (rel) => {
    const f = resolve(SRC, rel);
    if (!existsSync(f)) throw new Error(`missing ${f} - place the Kenney packs in art-src/kenney`);
    return toRgba(decodePng(readFileSync(f)));
};
const save = (rel, img, alpha = true) => {
    const f = resolve(OUT, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, encodePng(img, alpha));
    console.log(`wrote public/images/${rel}`);
};
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
/** Piecewise-linear colour ramp; stops = [[t, rgb], ...]. */
const ramp = (stops, t) => {
    t = Math.min(1, Math.max(0, t));
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) return lerp(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0] || 1));
    }
    return stops[stops.length - 1][1];
};

// ----------------------------------------------------------------- spark
function buildSpark() {
    const img = resize(load('particle-pack/PNG (Transparent)/star_04.png'), 64, 64);
    // white sprite with the brightness carried by alpha; the game tints it per hit
    for (let i = 0; i < 64 * 64; i++) {
        const o = i * 4;
        const lum = (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3 / 255;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(img.data[o + 3] * Math.min(1, lum * 1.15));
    }
    save('spark.png', img);
}

// -------------------------------------------------------------- textures
/** Downscales a prototype texture to 256 and maps line strength (distance from the base tone) onto a ramp. */
function buildTexture(out, src, stops, { gain = 6, band = null } = {}) {
    const img = resize(load(`prototype-textures/PNG/${src}`), 256, 256);
    const lum = new Float32Array(256 * 256);
    for (let i = 0; i < lum.length; i++) lum[i] = (0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]) / 255;
    const base = Float32Array.from(lum).sort()[lum.length >> 1];
    const data = new Uint8Array(256 * 256 * 4);
    for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
            const i = y * 256 + x;
            const strength = Math.abs(lum[i] - base) * gain;
            const col = band && band.test(x, y) ? band.colour : ramp(stops, strength);
            data.set([col[0], col[1], col[2], 255], i * 4);
        }
    }
    save(`textures/${out}.png`, { width: 256, height: 256, data }, false);
}

function buildTextures() {
    const orange = C('#ff8a2a');
    const grey = [[0, C('#8a929c')], [1, C('#3b4048')]];
    // Range: grey concrete with orange markings
    buildTexture('floor-range', 'Light/texture_01.png', grey, { gain: 14, band: { colour: orange, test: (x, y) => x < 2 || y < 2 } });
    buildTexture('wall-range', 'Light/texture_02.png', grey, { gain: 14, band: { colour: orange, test: (x, y) => y < 6 || y > 249 } });
    // Neon: near-black blue with cyan lines
    buildTexture('floor-neon', 'Dark/texture_02.png', [[0, NAVY1], [0.35, NAVY2], [1, C('#49e3ff')]], { gain: 7 });
    buildTexture('wall-neon', 'Dark/texture_04.png', [[0, NAVY0], [0.4, NAVY2], [1, C('#49e3ff')]], { gain: 6 });
    // Vault: dark steel with amber lines
    buildTexture('floor-vault', 'Dark/texture_06.png', [[0, NAVY0], [0.45, C('#3b4048')], [1, C('#ffd23f')]], { gain: 6 });
    buildTexture('wall-vault', 'Dark/texture_08.png', [[0, NAVY1], [0.5, C('#5a4630')], [1, C('#ffd23f')]], { gain: 6 });
}

// ------------------------------------------------------------ thumbnails
/**
 * Level thumbnails are composed from the shipped floor/wall textures (perspective
 * floor, wall band, fog to the base navy) and the source hash is recorded in
 * data/themes.json so the validator fails when a texture changes without a rebuild.
 */
function buildThumbs() {
    const W = 640; const H = 359; const HOR = 170;
    const themesPath = resolve(ROOT, 'data/themes.json');
    const themes = JSON.parse(readFileSync(themesPath, 'utf8'));
    for (const t of themes.themes) {
        const floor = decodePng(readFileSync(resolve(OUT, '..', t.floorTexture.startsWith('images/') ? t.floorTexture : `images/${t.floorTexture}`)));
        const wall = decodePng(readFileSync(resolve(OUT, '..', t.wallTexture)));
        const data = new Uint8Array(W * H * 4);
        const tx = (img, u, v) => { const x = ((Math.floor(u * 256) % 256) + 256) % 256; const y = ((Math.floor(v * 256) % 256) + 256) % 256; const o = (y * 256 + x) * img.channels; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                let col; let fog;
                if (y < HOR) { col = tx(wall, x / 160, (y / HOR) * 1.2); fog = 0.15; }
                else {
                    const d = (y - HOR + 1) / (H - HOR);
                    col = tx(floor, ((x - W / 2) / W) / d * 1.4, 0.6 / d); fog = Math.max(0, 0.75 - d * 1.2);
                }
                const vig = 1 - Math.hypot((x - W / 2) / W, (y - H / 2) / H) * 0.9;
                const k = Math.max(0, Math.min(1, vig));
                const f = lerp(col.map((c) => c * k), NAVY0, fog);
                data.set([f[0], f[1], f[2], 255], (y * W + x) * 4);
            }
        }
        const rel = t.thumb.replace(/^images\//, '');
        save(rel, { width: W, height: H, data }, false);
        t.thumbSource = thumbSourceHash(ROOT, t);
    }
    writeFileSync(themesPath, JSON.stringify(themes, null, 2) + '\n');
}

function copyLicences() {
    for (const pack of ['particle-pack', 'prototype-textures']) {
        const from = resolve(SRC, pack, 'License.txt');
        if (!existsSync(from)) continue;
        mkdirSync(resolve(ROOT, 'LICENSES'), { recursive: true });
        copyFileSync(from, resolve(ROOT, 'LICENSES', `kenney-${pack}.txt`));
    }
}

buildSpark();
buildTextures();
buildThumbs();
if (process.argv.includes('--licences')) copyLicences();
