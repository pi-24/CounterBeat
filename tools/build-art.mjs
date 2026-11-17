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
 *   toon-characters   Robot/PNG/Poses -> bot-sheet, bot-hex-sheet, bot-chevron-sheet
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

// ------------------------------------------------------------------ bots
const FW = 96; const FH = 128; const COLS = 5;
const VARIANTS = {
    bot: { accent: C('#49e3ff'), eye: C('#ffd23f'), gem: C('#ff3fb4'), mark: null },
    'bot-hex': { accent: C('#ff3fb4'), eye: C('#ffffff'), gem: C('#49e3ff'), mark: 'hex' },
    'bot-chevron': { accent: C('#ffd23f'), eye: C('#ff8a2a'), gem: C('#ffffff'), mark: 'chevron' },
};

function hsv(r, g, b) {
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: mx ? d / mx : 0 };
}

/** Recolours a robot pose: flat navy body, accent trim, white highlights, palette eye and gem. */
function recolour(pose, v, { flash = 0, alpha = 1, shift = 0 } = {}) {
    const out = new Uint8Array(FW * FH * 4);
    for (let y = 0; y < FH; y++) {
        const sy = y - shift;
        if (sy < 0 || sy >= FH) continue;
        for (let x = 0; x < FW; x++) {
            const s = (sy * FW + x) * 4; const o = (y * FW + x) * 4;
            if (pose.data[s + 3] < 8) continue;
            const r = pose.data[s]; const g = pose.data[s + 1]; const b = pose.data[s + 2];
            const { h, s: sat } = hsv(r, g, b);
            let col;
            if (sat > 0.5 && h >= 30 && h <= 75) col = v.eye;
            else if (sat > 0.35 && (h >= 300 || h <= 25)) col = v.gem;
            else {
                const lum = Math.min(1, (0.299 * r + 0.587 * g + 0.114 * b) / 255 + flash);
                col = lum < 0.2 ? NAVY0 : lum < 0.5 ? NAVY2 : lum < 0.68 ? v.accent : WHITE;
                if (flash > 0.3 && lum > 0.3) col = lum > 0.85 ? WHITE : v.accent; // hit flash: accent-lit body, white only on highlights
            }
            out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2];
            out[o + 3] = Math.round(pose.data[s + 3] * alpha);
        }
    }
    return out;
}

/** Scanline polygon fill into a layer (alpha 255 where filled). */
function fillPoly(layer, pts) {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(FH - 1, Math.ceil(Math.max(...ys))); y++) {
        for (let x = 0; x < FW; x++) {
            let inside = false;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
                if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
            }
            if (inside) layer[(y * FW + x) * 4 + 3] = 255;
        }
    }
}

const hexPts = (r, cy) => Array.from({ length: 6 }, (_, i) => [49 + r * Math.cos((i * Math.PI) / 3 + Math.PI / 6), cy + r * Math.sin((i * Math.PI) / 3 + Math.PI / 6)]);

/** Marking layer: a hexagon ring round the eye, or a pair of chevrons on the torso. */
function markLayer(kind, shift) {
    const layer = new Uint8Array(FW * FH * 4);
    if (kind === 'hex') {
        fillPoly(layer, hexPts(17, 66 + shift));
        const inner = new Uint8Array(layer.length);
        fillPoly(inner, hexPts(14, 66 + shift));
        for (let i = 3; i < layer.length; i += 4) if (inner[i]) layer[i] = 0;
    } else {
        for (const dy of [0, 7]) {
            fillPoly(layer, [[38, 104 + shift + dy], [48, 110 + shift + dy], [58, 104 + shift + dy], [58, 108 + shift + dy], [48, 114 + shift + dy], [38, 108 + shift + dy]]);
        }
    }
    return layer;
}

function buildBotSheet(name, v) {
    const pose = (n) => load(`toon-characters/Robot/PNG/Poses/character_robot_${n}.png`);
    const frame = (p, opts = {}, marked = true) => {
        const buf = recolour(p, v, opts);
        if (marked && v.mark) {
            const layer = markLayer(v.mark, opts.shift ?? 0);
            const c = opts.flash > 0.3 ? WHITE : v.mark === 'hex' ? WHITE : v.accent;
            for (let i = 0; i < buf.length; i += 4) {
                if (layer[i + 3] && buf[i + 3] > 200) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; }
            }
        }
        return buf;
    };
    const idle = pose('idle');
    const frames = [
        ...[0, -1, -2, -1].map((shift) => frame(idle, { shift })),            // 0-3 idle bob
        frame(idle, { flash: 0.85, shift: -2 }),                               // 4-5 hit flash
        frame(idle, { flash: 0.25, shift: -1 }),
        frame(pose('fall'), { alpha: 0.95 }, false),                           // 6-9 collapse and fade
        frame(pose('fallDown'), { alpha: 0.8 }, false),
        frame(pose('down'), { alpha: 0.5 }, false),
        frame(pose('down'), { alpha: 0.15 }, false),
    ];
    const rows = Math.ceil(frames.length / COLS);
    const sheet = new Uint8Array(FW * COLS * FH * rows * 4);
    frames.forEach((f, i) => {
        const ox = (i % COLS) * FW; const oy = Math.floor(i / COLS) * FH;
        for (let y = 0; y < FH; y++) sheet.set(f.subarray(y * FW * 4, (y + 1) * FW * 4), ((oy + y) * FW * COLS + ox) * 4);
    });
    save(`${name}-sheet.png`, { width: FW * COLS, height: FH * rows, data: sheet });
}

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
    for (const pack of ['toon-characters', 'particle-pack', 'prototype-textures']) {
        const from = resolve(SRC, pack, 'License.txt');
        if (!existsSync(from)) continue;
        mkdirSync(resolve(ROOT, 'LICENSES'), { recursive: true });
        copyFileSync(from, resolve(ROOT, 'LICENSES', `kenney-${pack}.txt`));
    }
}

for (const [name, v] of Object.entries(VARIANTS)) buildBotSheet(name, v);
buildSpark();
buildTextures();
buildThumbs();
if (process.argv.includes('--licences')) copyLicences();
