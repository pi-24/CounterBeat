/**
 * chartLoader.js
 *
 * The versioned chart format, loaded by the same module in the client, the
 * edge function and the tools.  A hand-authored chart is a JSON file
 * `charts/<track>/<difficulty>.json`:
 *
 *   { format: 1, chartId, chartVersion, contentHash,
 *     bpm, bars, firstNoteBar, gridOffset, lanes,
 *     notes: [[beat, lane], ...] }          beat = beats from the grid start
 *
 * `contentHash` is the SHA-256 of the canonical content (everything but the
 * hash itself), so a tampered note, tempo or version is detected.  The files
 * are bundled into chartIndex.js by `node tools/chart-hash.mjs --write`.
 *
 * Canonical hashing: the hash is SHA-256 of `JSON.stringify([format, chartId,
 * chartVersion, bpm, bars, firstNoteBar, gridOffset, lanes, notes])`, i.e. over
 * parsed values, so file whitespace, key order and number formatting (0.625 vs
 * 6.25e-1) never change it.  Edit notes, then `node tools/chart-hash.mjs --rehash`
 * and bump chartVersion.
 *
 * Engine-free and dependency-free: copied to the edge function by
 * `npm run sync-rules`.
 */
import CHART_INDEX from './chartIndex.js';

export const CHART_FORMAT = 1;

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** @param {string} text @returns {Uint8Array} UTF-8 bytes (no TextEncoder needed). */
function utf8(text) {
    const out = [];
    for (const ch of text) {
        const c = ch.codePointAt(0);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
}

/** @param {string} text @returns {string} hex SHA-256, synchronous. */
export function sha256(text) {
    const bytes = utf8(text);
    const total = (((bytes.length + 9 + 63) >> 6) << 6);
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 4, (bytes.length * 8) >>> 0);
    view.setUint32(total - 8, Math.floor((bytes.length * 8) / 0x100000000));
    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i += 1) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i += 1) {
            const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        const add = [a, b, c, d, e, f, g, hh];
        for (let i = 0; i < 8; i += 1) h[i] = (h[i] + add[i]) >>> 0;
    }
    return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** @param {object} chart a chart file @returns {string} the content hash it should carry. */
export function computeContentHash(chart) {
    return sha256(JSON.stringify([
        chart.format, chart.chartId, chart.chartVersion, chart.bpm, chart.bars,
        chart.firstNoteBar, chart.gridOffset, chart.lanes, chart.notes,
    ]));
}

/**
 * Structural and hash check of one chart file.
 * @param {object} chart
 * @param {{minVersion?: number}} [options] charts older than minVersion are retired
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function verifyChart(chart, options = {}) {
    const fail = (reason) => ({ ok: false, reason });
    if (!chart || chart.format !== CHART_FORMAT) return fail('unsupported chart format');
    if (typeof chart.chartId !== 'string' || !Number.isInteger(chart.chartVersion) || chart.chartVersion < 1) {
        return fail('malformed chart');
    }
    if (!Array.isArray(chart.notes) || chart.notes.length === 0
        || !Number.isFinite(chart.bpm) || !Number.isInteger(chart.lanes)) {
        return fail('malformed chart');
    }
    let last = -1;
    for (const note of chart.notes) {
        if (!Array.isArray(note) || !Number.isFinite(note[0]) || note[0] < last
            || !Number.isInteger(note[1]) || note[1] < 0 || note[1] >= chart.lanes) {
            return fail('malformed chart notes');
        }
        last = note[0];
    }
    if (options.minVersion !== undefined && chart.chartVersion < options.minVersion) {
        return fail('chart version is outdated');
    }
    if (computeContentHash(chart) !== chart.contentHash) {
        return fail('chart content hash mismatch');
    }
    return { ok: true };
}

/**
 * @param {string} chartId e.g. t:neon:hard
 * @param {Record<string, object>} [index] chart files by chartId
 * @returns {{ok: true, chart: object} | {ok: false, reason: string}} an
 *   authored chart, verified once and cached; `reason: 'none'` when the
 *   chart is generated rather than authored.
 */
const verified = new Map();
export function loadChart(chartId, index = CHART_INDEX) {
    const file = index[chartId];
    if (!file) return { ok: false, reason: 'none' };
    if (index === CHART_INDEX && verified.has(chartId)) return verified.get(chartId);
    const check = verifyChart(file);
    const result = check.ok ? { ok: true, chart: file } : check;
    if (index === CHART_INDEX) verified.set(chartId, result);
    return result;
}

/**
 * @param {string} chartId
 * @returns {{chartVersion: number, contentHash: string} | null} what a run on
 *   this chart must declare; null for generated charts.
 */
export function chartRef(chartId) {
    const loaded = loadChart(chartId);
    return loaded.ok ? { chartVersion: loaded.chart.chartVersion, contentHash: loaded.chart.contentHash } : null;
}

/**
 * The server-side check: does a run's declared chart version and hash match
 * the chart the server holds?  Generated charts have nothing to match.
 * @param {object} level a chart definition from charts.js
 * @param {{chartVersion?: number, chartHash?: string}} log
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkRunChartRef(level, log) {
    if (!level.contentHash) return { ok: true };
    if (log.chartVersion !== level.chartVersion) return { ok: false, reason: 'chart version mismatch' };
    if (log.chartHash !== level.contentHash) return { ok: false, reason: 'chart hash mismatch' };
    return { ok: true };
}
