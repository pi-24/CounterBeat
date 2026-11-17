/**
 * validate-assets.mjs
 *
 * Validates data/*.json manifests: schema, required fields, licence file or
 * placeholder flag, referenced files, PNG format and palette conformity.
 * Exit code 1 on any error.  Also importable (validateAll) for tests.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { buildCredits, creditsMarkdown } from '../src/ui/creditsData.js';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadManifest(name, root = ROOT) {
    return JSON.parse(readFileSync(resolve(root, 'data', name), 'utf8'));
}

// ------------------------------------------------------------- PNG reading
/** Decodes an 8-bit, non-interlaced PNG. @returns {{width,height,channels,data:Uint8Array}} */
export function decodePng(buffer) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (buffer.length < 33 || sig.some((b, i) => buffer[i] !== b)) throw new Error('not a PNG file');
    let pos = 8; let header = null; let plte = null; let trns = null; const idat = [];
    while (pos < buffer.length) {
        const len = buffer.readUInt32BE(pos);
        const type = buffer.toString('ascii', pos + 4, pos + 8);
        const body = buffer.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9], interlace: body[12] };
        } else if (type === 'PLTE') plte = body;
        else if (type === 'tRNS') trns = body;
        else if (type === 'IDAT') idat.push(body);
        else if (type === 'IEND') break;
        pos += 12 + len;
    }
    if (!header) throw new Error('PNG has no IHDR');
    if (header.interlace !== 0) throw new Error('format: interlaced PNG not supported; re-export without interlacing');
    if (header.colour === 3 ? ![1, 2, 4, 8].includes(header.depth) : header.depth !== 8) {
        throw new Error(`format: ${header.depth}-bit PNG not supported; re-export as 8-bit RGBA`);
    }
    if (header.colour === 3 && !plte) throw new Error('format: indexed PNG has no PLTE palette chunk');
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4, 3: 1 }[header.colour];
    if (!channels) throw new Error(`format: unsupported PNG colour type ${header.colour}`);
    const bits = header.colour === 3 ? header.depth : 8;
    const raw = inflateSync(Buffer.concat(idat));
    const stride = Math.ceil((header.width * channels * bits) / 8);
    const bpp = Math.max(1, (channels * bits) >> 3);
    const out = new Uint8Array(stride * header.height);
    for (let y = 0; y < header.height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? out[y * stride + x - bpp] : 0;
            const b = y > 0 ? out[(y - 1) * stride + x] : 0;
            const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
            let v = line[x];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            } else if (filter > 4) throw new Error('bad PNG filter');
            out[y * stride + x] = v & 255;
        }
    }
    if (header.colour !== 3) return { width: header.width, height: header.height, channels, data: out };
    // expand indexed pixels to RGBA
    const rgba = new Uint8Array(header.width * header.height * 4);
    for (let y = 0; y < header.height; y++) {
        for (let x = 0; x < header.width; x++) {
            const bit = x * bits;
            const idx = (out[y * stride + (bit >> 3)] >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
            const o = (y * header.width + x) * 4;
            rgba.set([plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2], trns && idx < trns.length ? trns[idx] : 255], o);
        }
    }
    return { width: header.width, height: header.height, channels: 4, data: rgba };
}

export function hexToRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) throw new Error(`bad colour "${hex}"`);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Palette conformity of an image: `mean` and `max` nearest-palette distance
 * (0..1) over opaque pixels, and `outlierFraction`, the share of opaque pixels
 * farther than `pixelTolerance` from every palette colour.
 */
export function paletteStats(image, palette, pixelTolerance = 0.25) {
    const colours = palette.map(hexToRgb);
    const { data, channels, width, height } = image;
    let total = 0; let count = 0; let max = 0; let outliers = 0;
    for (let i = 0; i < width * height; i++) {
        const o = i * channels;
        const alpha = channels === 4 ? data[o + 3] : channels === 2 ? data[o + 1] : 255;
        if (alpha < 128) continue;
        const rgb = channels >= 3 ? [data[o], data[o + 1], data[o + 2]] : [data[o], data[o], data[o]];
        let best = Infinity;
        for (const c of colours) {
            const d = Math.hypot(rgb[0] - c[0], rgb[1] - c[1], rgb[2] - c[2]) / 441.67;
            if (d < best) best = d;
        }
        total += best; count++; if (best > max) max = best; if (best > pixelTolerance) outliers++;
    }
    return { mean: count ? total / count : 0, max, outlierFraction: count ? outliers / count : 0 };
}

/** Mean nearest-palette distance (kept for callers/tests). */
export function paletteDistance(image, palette) {
    return paletteStats(image, palette).mean;
}

/** Hash of the textures a level thumbnail is derived from (tools/build-art.mjs buildThumbs). */
export function thumbSourceHash(root, theme) {
    const h = createHash('sha256');
    for (const f of [theme.floorTexture, theme.wallTexture]) { const file = resolve(root, 'public', f); if (existsSync(file)) h.update(readFileSync(file)); }
    return h.digest('hex');
}

// -------------------------------------------------------------- validation
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isColour = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => isNum(n) && n >= 0 && n <= 1);

/** @returns {string[]} errors */
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

/** Image references that actually load: url(), <img src>, import specifiers. Comments are ignored. */
export function imageRefs(text) {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
    const out = [];
    const pats = [
        /url\(\s*['"]?([^)'"\s]+)/gi,
        /<img\b[^>]*?\ssrc\s*=\s*['"]([^'"]+)['"]/gi,
        /\bimport\s*(?:[^'"()]*?\bfrom\s*)?\(?\s*['"]([^'"]+)['"]/g,
    ];
    for (const re of pats) for (const m of clean.matchAll(re)) if (IMG_EXT.test(m[1].split(/[?#]/)[0])) out.push(m[1]);
    return out;
}

/** Resolve a reference to a public-relative path (the manifest form); null for external/data URLs. */
export function canonicalImageRef(raw, fromDir, root) {
    const r = raw.split(/[?#]/)[0];
    if (/^(https?:|data:)/i.test(r)) return null;
    let abs = r.startsWith('/') ? resolve(root, 'public', r.slice(1)) : resolve(fromDir, r);
    let rel = abs.slice(root.length + 1).split('\\').join('/');
    if (rel.startsWith('public/')) rel = rel.slice(7);
    return rel;
}

export function validateAll({ root = ROOT, manifests } = {}) {
    const errors = [];
    const err = (m) => errors.push(m);
    const load = (n) => manifests?.[n.replace('.json', '')] ?? loadManifest(n, root);
    let tracks, themes, targets, crosshairs, art;
    try {
        tracks = load('tracks.json'); themes = load('themes.json');
        targets = load('targets.json'); crosshairs = load('crosshairs.json'); art = load('art.json');
    } catch (e) { return [`cannot read manifests: ${e.message}`]; }

    const publicFile = (rel, what) => {
        if (!isStr(rel)) { err(`${what}: missing path`); return null; }
        const full = resolve(root, 'public', rel);
        if (!existsSync(full)) { err(`${what}: file not found public/${rel}`); return null; }
        return full;
    };
    const checkIds = (list, what) => {
        const seen = new Set();
        if (!Array.isArray(list) || list.length === 0) { err(`${what}: must be a non-empty array`); return; }
        for (const e of list) {
            if (!isStr(e.id)) err(`${what}: entry without id`);
            else if (seen.has(e.id)) err(`${what}: duplicate id ${e.id}`);
            else seen.add(e.id);
            if (!isStr(e.name) && !isStr(e.title)) err(`${what} ${e.id}: missing name`);
            if (what !== 'tracks' && !(isNum(e.starCost) && e.starCost >= 0)) err(`${what} ${e.id}: starCost must be a number >= 0`);
        }
    };

    for (const [name, m] of [['tracks', tracks], ['themes', themes], ['targets', targets], ['crosshairs', crosshairs]]) {
        if (!Number.isInteger(m.version) || m.version < 1) err(`${name}.json: version must be a positive integer`);
    }

    // tracks
    checkIds(tracks.tracks, 'tracks');
    for (const t of tracks.tracks ?? []) {
        for (const f of ['artist', 'key', 'scale', 'arena']) if (!isStr(t[f])) err(`track ${t.id}: missing ${f}`);
        for (const f of ['bpm', 'bars', 'firstNoteBar', 'chartVersion', 'seed']) if (!isNum(t[f])) err(`track ${t.id}: ${f} must be a number`);
        if (!isNum(t.offset)) err(`track ${t.id}: offset must be a number`);
        if (typeof t.placeholder !== 'boolean') err(`track ${t.id}: placeholder flag must be boolean`);
        if (!t.placeholder && !isStr(t.licence)) err(`track ${t.id}: needs a licence file or placeholder:true`);
        if (isStr(t.licence) && !existsSync(resolve(root, t.licence))) err(`track ${t.id}: licence file ${t.licence} not found`);
        if (!Array.isArray(t.audio) || t.audio.length === 0) err(`track ${t.id}: audio must list URLs`);
        else for (const u of t.audio) publicFile(u, `track ${t.id} audio`);
        if (!(themes.themes ?? []).some((th) => th.id === t.arena)) err(`track ${t.id}: unknown theme ${t.arena}`);
    }
    for (const [key, urls] of Object.entries(tracks.sfx ?? {})) {
        if (!Array.isArray(urls) || !urls.length) err(`sfx ${key}: needs URLs`); else urls.forEach((u) => publicFile(u, `sfx ${key}`));
    }
    (tracks.menuMusic?.audio ?? []).forEach((u) => publicFile(u, 'menuMusic'));
    if (!isStr(tracks.menuMusic?.key)) err('menuMusic: missing key');

    // palette
    const palette = themes.palette;
    if (!palette || !Array.isArray(palette.colours) || palette.colours.length < 3) err('themes.json: palette.colours required');
    else if (![palette.tolerance, palette.pixelTolerance, palette.maxOutlierFraction].every(isNum)) err('themes.json: palette.tolerance, pixelTolerance and maxOutlierFraction required');
    else { try { palette.colours.forEach(hexToRgb); } catch (e) { err(e.message); } }

    const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
    const referenced = new Set();
    const checkLicence = (lic, what) => {
        if (!isStr(lic)) err(`${what}: missing licence path`);
        else if (!existsSync(resolve(root, lic))) err(`${what}: licence file ${lic} not found`);
    };
    const checkImage = (rel, what, { pow2 = false, licence } = {}) => {
        if (isStr(rel)) referenced.add(rel.split('\\').join('/'));
        checkLicence(licence, what);
        const full = publicFile(rel, what);
        if (!full) return;
        if (extname(full).toLowerCase() !== '.png') { err(`${what}: ${rel} must be a PNG`); return; }
        try {
            const img = decodePng(readFileSync(full));
            if (palette?.colours && isNum(palette.tolerance) && isNum(palette.pixelTolerance) && isNum(palette.maxOutlierFraction)) {
                const st = paletteStats(img, palette.colours, palette.pixelTolerance);
                if (st.mean > palette.tolerance) err(`${what}: ${rel} off-palette (mean distance ${st.mean.toFixed(3)} > ${palette.tolerance})`);
                if (st.outlierFraction > palette.maxOutlierFraction) {
                    err(`${what}: ${rel} has ${(st.outlierFraction * 100).toFixed(1)}% pixels beyond ${palette.pixelTolerance} of the palette (max ${palette.maxOutlierFraction * 100}%)`);
                }
            }
            if (pow2 && !(isPow2(img.width) && isPow2(img.height))) {
                err(`${what}: ${rel} is ${img.width}x${img.height}; textures must be power-of-two`);
            }
        } catch (e) { err(`${what}: ${rel}: ${e.message}`); }
    };

    // themes
    checkIds(themes.themes, 'themes');
    if ((themes.themes ?? []).length < 3) err('themes: need at least 3');
    for (const t of themes.themes ?? []) {
        if (t.thumbSource !== thumbSourceHash(root, t)) err(`theme ${t.id}: thumb is stale (textures changed); run node tools/build-art.mjs`);
        for (const f of ['floorTexture', 'wallTexture', 'thumb']) checkImage(t[f], `theme ${t.id} ${f}`, { pow2: f !== 'thumb', licence: t.licence });
        if (!isColour(t.sky)) err(`theme ${t.id}: sky must be [r,g,b] 0..1`);
        if (!isColour(t.accent)) err(`theme ${t.id}: accent must be [r,g,b] 0..1`);
        if (!isColour(t.fog?.colour) || !isNum(t.fog?.density)) err(`theme ${t.id}: fog needs colour and density`);
        if (!isNum(t.ambient)) err(`theme ${t.id}: ambient must be a number`);
        if (!isStr(t.decor)) err(`theme ${t.id}: missing decor`);
        if (typeof t.placeholder !== 'boolean') err(`theme ${t.id}: placeholder flag must be boolean`);
    }

    // targets
    checkIds(targets.targets, 'targets');
    if ((targets.targets ?? []).length < 3) err('targets: need at least 3 skins');
    checkImage(targets.spark?.path, 'spark', { licence: targets.spark?.licence });
    for (const t of targets.targets ?? []) {
        checkImage(t.sheet, `target ${t.id} sheet`, { licence: t.licence });
        if (!isNum(t.cellWidth) || !isNum(t.cellHeight)) err(`target ${t.id}: cellWidth/cellHeight required`);
        if (typeof t.placeholder !== 'boolean') err(`target ${t.id}: placeholder flag must be boolean`);
    }

    // crosshairs
    checkIds(crosshairs.crosshairs, 'crosshairs');
    if ((crosshairs.crosshairs ?? []).length < 10) err('crosshairs: need at least 10');
    for (const c of crosshairs.crosshairs ?? []) {
        if (!isStr(c.shape)) err(`crosshair ${c.id}: missing shape`);
        if (!/^#[0-9a-f]{6}$/i.test(c.colour ?? '')) err(`crosshair ${c.id}: colour must be #rrggbb`);
        checkLicence(c.licence, `crosshair ${c.id}`);
    }

    // other images (emblem, hero, ...)
    for (const p of art?.packs ?? []) {
        if (!isStr(p.id) || !isStr(p.name) || !isStr(p.author)) err('art.json: pack needs id, name and author');
        else if (!isStr(p.licence) || !existsSync(resolve(root, p.licence))) err(`art pack ${p.id}: licence file "${p.licence}" does not exist`);
    }
    {
        const known = new Set((art?.packs ?? []).map((p) => p.licence));
        const used = [...(themes?.themes ?? []), ...(targets?.targets ?? []), targets?.spark, ...(crosshairs?.crosshairs ?? []), ...(art?.images ?? [])];
        for (const e of used) {
            if (e?.licence && /^LICENSES\/kenney-/.test(e.licence) && !known.has(e.licence)) err(`${e.id}: pack licence ${e.licence} is not listed in art.json packs`);
        }
    }
    if (!Array.isArray(art?.images)) err('art.json: images must be an array');
    for (const i of art?.images ?? []) {
        if (!isStr(i.id) || !isStr(i.name)) err('art.json: image needs id and name');
        checkImage(i.path, `art ${i.id}`, { licence: i.licence });
    }

    // every image under public/ must be in a manifest; HTML, CSS and src/ may not
    // reference any image (url(), <img>, import) that is not a manifest entry.
    const walk = (dir, base) => {
        if (!existsSync(dir)) return [];
        return readdirSync(dir).flatMap((n) => {
            const full = resolve(dir, n); const rel = `${base}${n}`;
            return statSync(full).isDirectory() ? walk(full, `${rel}/`) : [rel];
        });
    };
    const scanFiles = (dir) => {
        if (!existsSync(dir)) return [];
        return readdirSync(dir).flatMap((n) => {
            const full = resolve(dir, n);
            if (statSync(full).isDirectory()) return n === 'node_modules' ? [] : scanFiles(full);
            return /\.(html|css|js|mjs)$/i.test(n) ? [full] : [];
        });
    };
    for (const f of walk(resolve(root, 'public'), '')) {
        if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(f) && !referenced.has(f)) err(`image public/${f} is not in any manifest`);
    }

    const sources = [...scanFiles(resolve(root, 'src')), ...readdirSync(root).filter((n) => /\.html$/i.test(n)).map((n) => resolve(root, n))];
    for (const file of sources) {
        const rel = file.slice(root.length + 1);
        for (const raw of imageRefs(readFileSync(file, 'utf8'))) {
            const ref = canonicalImageRef(raw, resolve(file, '..'), root);
            if (ref && !referenced.has(ref)) err(`${rel} references image ${raw} which is not in any manifest`);
        }
    }

    // UI design system (direction C): art.json.uiPalette must match tokens.css; fonts are self-hosted with licences
    {
        const ui = art?.uiPalette;
        const tokensFile = resolve(root, 'src/styles/tokens.css');
        if (!ui || typeof ui.colours !== 'object') err('art.json: uiPalette.colours required');
        else {
            for (const [name, hex] of Object.entries(ui.colours)) {
                try { hexToRgb(hex); } catch (e) { err(`art.json uiPalette ${name}: ${e.message}`); continue; }
                if (existsSync(tokensFile) && !new RegExp(`--${name}:\\s*${hex};`, 'i').test(readFileSync(tokensFile, 'utf8'))) {
                    err(`tokens.css does not define --${name}: ${hex} (art.json uiPalette)`);
                }
            }
            for (const [grade, j] of Object.entries(ui.judgements ?? {})) {
                if (!(j.token in ui.colours)) err(`art.json uiPalette judgement ${grade}: unknown token ${j.token}`);
                if (!isStr(j.shape)) err(`art.json uiPalette judgement ${grade}: shape required`);
            }
            if (new Set(Object.values(ui.judgements ?? {}).map((j) => j.shape)).size !== 4) err('art.json uiPalette: four judgements need four distinct shapes');
        }
        if (!Array.isArray(art?.fonts) || art.fonts.length < 3) err('art.json: fonts must list Anton, Archivo and Space Mono');
        for (const f of art?.fonts ?? []) {
            if (!isStr(f.id) || !isStr(f.name) || !isStr(f.author)) err('art.json: font needs id, name and author');
            else checkLicence(f.licence, `font ${f.id}`);
        }
        const fontCss = resolve(root, 'src/styles/fonts.css');
        if (existsSync(fontCss)) {
            const css = readFileSync(fontCss, 'utf8');
            if (/https?:\/\//.test(css)) err('fonts.css must not load fonts over the network (the Steam build runs offline)');
            for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
                if (!existsSync(resolve(fontCss, '..', m[1].replace(/['"]/g, '')))) err(`fonts.css: ${m[1]} not found (run npm install)`);
            }
        } else err('src/styles/fonts.css missing');
    }

    // CREDITS.md must list every pack and licence
    try {
        const file = resolve(root, 'CREDITS.md');
        if (!existsSync(file)) err('CREDITS.md missing; run node tools/gen-credits.mjs');
        else if (readFileSync(file, 'utf8') !== creditsMarkdown(buildCredits({ tracks, themes, targets, crosshairs, art }))) err('CREDITS.md is stale; run node tools/gen-credits.mjs');
    } catch (e) { err(`CREDITS.md check failed: ${e.message}`); }
    return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const errors = validateAll();
    if (errors.length) {
        for (const e of errors) console.error(`ERROR ${e}`);
        process.exit(1);
    }
    console.log('asset manifests valid');
}
