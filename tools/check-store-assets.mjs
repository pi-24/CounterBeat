/**
 * check-store-assets.mjs - asserts the local Steam store assets exist at the exact required pixel sizes
 * and format (PNG), that the library logo really has transparency, that there are at least 5 gameplay
 * screenshots at 1920x1080, and that the trailer cut list and store text drafts are in shape.
 * Nothing here uploads anything.
 *
 *   node tools/check-store-assets.mjs
 *
 * Art:         python tools/asset-tools/gen_store_art.py   (store/capsules)
 * Screenshots: npm run build && node tools/capture-store-shots.mjs   (store/screenshots)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Steam's required capsule sizes. `alpha: true` means the file must carry real transparency. */
export const REQUIRED_CAPSULES = [
    { file: 'header.png', width: 920, height: 430, what: 'header capsule' },
    { file: 'capsule-small.png', width: 462, height: 174, what: 'small capsule' },
    { file: 'capsule-main.png', width: 1232, height: 706, what: 'main capsule' },
    { file: 'capsule-vertical.png', width: 748, height: 896, what: 'vertical capsule' },
    { file: 'library-capsule.png', width: 600, height: 900, what: 'library capsule' },
    { file: 'library-hero.png', width: 3840, height: 1240, what: 'library hero' },
    { file: 'library-logo.png', width: 1280, height: 720, alpha: true, what: 'library logo' },
];
export const MIN_SCREENSHOTS = 5;
export const SCREENSHOT_SIZE = { width: 1920, height: 1080 };
export const TRAILER_SECONDS = { min: 30, max: 60 };
export const SHORT_DESCRIPTION_MAX = 300; // Steam's short description limit, in characters

/**
 * @param {Buffer} buf
 * @returns {{width:number, height:number, bitDepth:number, colorType:number, interlace:number}|null} null when not a PNG
 */
export function readPngHeader(buf) {
    if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        bitDepth: buf[24],
        colorType: buf[25],
        interlace: buf[28],
    };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

/** @param {Buffer} buf @returns {number} CRC-32 (the PNG chunk checksum) */
export function crc32(buf) {
    let c = 0xffffffff;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * Walks every chunk of a PNG and checks its CRC, so a truncated or corrupted file fails the check.
 * @param {Buffer} buf
 * @returns {string|null} a problem description, or null when every chunk is intact and the file ends with IEND
 */
export function pngCorruption(buf) {
    let pos = 8;
    let ended = false;
    while (pos + 12 <= buf.length) {
        const length = buf.readUInt32BE(pos);
        const end = pos + 12 + length;
        if (end > buf.length) return 'a chunk runs past the end of the file (truncated)';
        const type = buf.toString('ascii', pos + 4, pos + 8);
        if (crc32(buf.subarray(pos + 4, pos + 8 + length)) !== buf.readUInt32BE(pos + 8 + length)) return `bad CRC in the ${type} chunk`;
        if (type === 'IEND') ended = true;
        pos = end;
    }
    return ended ? null : 'no IEND chunk (truncated)';
}

const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Counts transparent and opaque pixels of an 8-bit, non-interlaced RGBA PNG.
 * @param {Buffer} buf
 * @returns {{transparent:number, opaque:number, total:number}}
 */
export function alphaStats(buf) {
    const head = readPngHeader(buf);
    if (!head || head.colorType !== 6 || head.bitDepth !== 8 || head.interlace !== 0) throw new Error('needs an 8-bit non-interlaced RGBA PNG');
    const parts = [];
    for (let pos = 8; pos < buf.length;) {
        const length = buf.readUInt32BE(pos);
        if (buf.toString('ascii', pos + 4, pos + 8) === 'IDAT') parts.push(buf.subarray(pos + 8, pos + 8 + length));
        pos += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(parts));
    const stride = head.width * 4;
    let prev = Buffer.alloc(stride);
    let transparent = 0;
    let opaque = 0;
    for (let y = 0; y < head.height; y++) {
        const base = y * (stride + 1);
        const filter = raw[base];
        const line = Buffer.from(raw.subarray(base + 1, base + 1 + stride));
        for (let i = 0; i < stride; i++) {
            const left = i >= 4 ? line[i - 4] : 0;
            const up = prev[i];
            const upLeft = i >= 4 ? prev[i - 4] : 0;
            const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
            line[i] = (line[i] + predictor) & 255;
        }
        for (let x = 3; x < stride; x += 4) {
            if (line[x] === 0) transparent++;
            else if (line[x] === 255) opaque++;
        }
        prev = line;
    }
    return { transparent, opaque, total: head.width * head.height };
}

/** @param {string} file @param {number} width @param {number} height @param {string} what @returns {string[]} problems */
function checkPng(file, width, height, what) {
    if (!existsSync(file)) return [`${what}: missing ${path.relative(ROOT, file)}`];
    const buf = readFileSync(file);
    const head = readPngHeader(buf);
    if (!head) return [`${what}: ${path.relative(ROOT, file)} is not a PNG`];
    if (head.width !== width || head.height !== height) return [`${what}: ${path.relative(ROOT, file)} is ${head.width}x${head.height}, needs ${width}x${height}`];
    const corrupt = pngCorruption(buf);
    if (corrupt) return [`${what}: ${path.relative(ROOT, file)} is corrupt: ${corrupt}`];
    return [];
}

/**
 * Parses a trailer cut list: table rows start with a shot number and carry a `m:ss-m:ss` range.
 * @param {string} text
 * @returns {{problems:string[], shots:number, seconds:number}}
 */
export function checkCutList(text) {
    const problems = [];
    const rows = [...text.matchAll(/^\|\s*(\d+)\s*\|\s*(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})\s*\|/gm)];
    let cursor = 0;
    let end = 0;
    rows.forEach((m, i) => {
        const start = Number(m[2]) * 60 + Number(m[3]);
        end = Number(m[4]) * 60 + Number(m[5]);
        if (Number(m[1]) !== i + 1) problems.push(`trailer: shot numbers must run 1..n (saw ${m[1]} at row ${i + 1})`);
        if (start !== cursor) problems.push(`trailer: shot ${m[1]} starts at ${start}s but the previous shot ended at ${cursor}s`);
        if (end <= start) problems.push(`trailer: shot ${m[1]} has no duration`);
        cursor = end;
    });
    if (rows.length < 5) problems.push(`trailer: needs at least 5 shot rows, found ${rows.length}`);
    if (end < TRAILER_SECONDS.min || end > TRAILER_SECONDS.max) problems.push(`trailer: runtime ${end}s is outside ${TRAILER_SECONDS.min}-${TRAILER_SECONDS.max}s`);
    if (!/beat/i.test(text)) problems.push('trailer: no beat markers');
    return { problems, shots: rows.length, seconds: end };
}

/** @param {string} text @returns {string} the body under a `## heading`, '' if absent */
function section(text, heading) {
    const m = text.match(new RegExp(`^## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
    return m ? m[1].trim() : '';
}

/** @param {string} text @returns {string[]} problems */
export function checkStoreText(text) {
    const problems = [];
    const short = section(text, 'Short description').replace(/^>\s?/gm, '').trim();
    if (!short) problems.push('store text: no "## Short description" section');
    else if (short.length > SHORT_DESCRIPTION_MAX) problems.push(`store text: short description is ${short.length} chars, Steam allows ${SHORT_DESCRIPTION_MAX}`);
    if (section(text, 'Long description').length < 400) problems.push('store text: "## Long description" missing or too short');
    return problems;
}

/** @param {string} [root] @returns {{problems:string[], notes:string[]}} */
export function checkStoreAssets(root = ROOT) {
    const problems = [];
    const notes = [];
    for (const c of REQUIRED_CAPSULES) {
        const file = path.join(root, 'store', 'capsules', c.file);
        const found = checkPng(file, c.width, c.height, c.what);
        problems.push(...found);
        if (found.length === 0) {
            notes.push(`${c.what}: ${c.width}x${c.height} ok`);
            const head = readPngHeader(readFileSync(file));
            if (c.alpha) {
                if (head.colorType !== 6) problems.push(`${c.what}: must be RGBA (colour type 6), is ${head.colorType}`);
                else {
                    try {
                        const s = alphaStats(readFileSync(file));
                        if (s.transparent < s.total * 0.15) problems.push(`${c.what}: only ${s.transparent} of ${s.total} pixels are transparent`);
                        if (s.opaque < 500) problems.push(`${c.what}: has no visible logo pixels`);
                    } catch (error) {
                        problems.push(`${c.what}: cannot read the alpha channel (${error.message}); save it as an 8-bit non-interlaced RGBA PNG`);
                    }
                }
            } else if (head.colorType === 6 || head.colorType === 4) {
                problems.push(`${c.what}: must not carry an alpha channel`);
            }
        }
    }
    const shotDir = path.join(root, 'store', 'screenshots');
    const shots = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => f.toLowerCase().endsWith('.png')).sort() : [];
    let goodShots = 0;
    for (const f of shots) {
        const found = checkPng(path.join(shotDir, f), SCREENSHOT_SIZE.width, SCREENSHOT_SIZE.height, `screenshot ${f}`);
        if (found.length) problems.push(...found); else goodShots++;
    }
    if (goodShots < MIN_SCREENSHOTS) problems.push(`screenshots: ${goodShots} valid 1920x1080 PNGs in store/screenshots, need at least ${MIN_SCREENSHOTS}`);
    else notes.push(`screenshots: ${goodShots} at 1920x1080 ok`);

    const read = (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : null);
    const cut = read('docs/trailer-cutlist.md');
    if (cut === null) problems.push('missing docs/trailer-cutlist.md');
    else {
        const r = checkCutList(cut);
        problems.push(...r.problems);
        if (!r.problems.length) notes.push(`trailer cut list: ${r.shots} shots, ${r.seconds}s ok`);
    }
    const text = read('docs/store-text-draft.md');
    if (text === null) problems.push('missing docs/store-text-draft.md');
    else problems.push(...checkStoreText(text));
    const handoff = read('docs/steam-handoff.md');
    if (handoff === null) problems.push('missing docs/steam-handoff.md');
    else for (const word of ['price', 'release date', 'age rating']) {
        if (!new RegExp(word, 'i').test(handoff)) problems.push(`docs/steam-handoff.md does not record the creator decision on ${word}`);
    }
    return { problems, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { problems, notes } = checkStoreAssets();
    for (const n of notes) console.log(`ok   ${n}`);
    for (const p of problems) console.error(`FAIL ${p}`);
    if (problems.length) {
        console.error(`\n${problems.length} problem(s)`);
        process.exit(1);
    }
    console.log('store assets ok');
}
