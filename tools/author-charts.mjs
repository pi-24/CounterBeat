/**
 * author-charts.mjs
 *
 * Authors the Hard and Expert charts in charts/<track>/<difficulty>.json from
 * a hand-written composition: a per-track SECTION PLAN (intro / verse /
 * build / drop / break / final, in bars), rhythm figures (downbeat accents,
 * syncopations and 16th bursts below) and lane motifs (sweeps, stairs,
 * pedals, zig-zags).  Every note sits on the 1/4-beat grid; strafe distances
 * are clamped to what the movement model can cover in the gap.
 *
 * The plan data is the authored part; this script realises it
 * deterministically.  Run it, then `node tools/chart-hash.mjs --rehash`.
 * The tracks are placeholders: when a real track replaces one, re-author its
 * plan against the real audio and bump the chart version.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeContentHash, CHART_FORMAT } from '../src/game/charts/chartLoader.js';
import { buildProceduralChart } from '../src/game/rules/charts.js';
import { CounterStrafeBody } from '../src/game/rules/CounterStrafeBody.js';
import { chartQualityProblems } from './lib/chart-quality.mjs';
import { LAYOUT } from '../src/game/rules/config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracks = JSON.parse(readFileSync(resolve(root, 'data/tracks.json'), 'utf8')).tracks;

/** Rhythm figures per bar, as 1/4-beat slots 0..15, keyed by note count. */
const FIGURES = {
    2: [[0, 8], [0, 10]],
    3: [[0, 6, 10], [0, 4, 10], [0, 8, 14]],
    4: [[0, 4, 8, 12], [0, 3, 8, 11], [0, 6, 8, 14]],
    5: [[0, 3, 6, 8, 12], [0, 4, 6, 10, 12], [0, 4, 8, 11, 14]],
    6: [[0, 1, 2, 8, 9, 10], [0, 1, 2, 8, 9, 10], [0, 2, 6, 8, 10, 14], [0, 4, 6, 8, 12, 14], [0, 3, 6, 8, 11, 14]],
    7: [[0, 1, 2, 8, 9, 10, 12], [0, 1, 2, 8, 9, 10, 12], [0, 2, 4, 8, 10, 12, 14], [0, 3, 4, 6, 8, 11, 12], [0, 2, 6, 8, 10, 12, 14]],
    8: [[0, 1, 2, 3, 8, 9, 10, 11], [0, 1, 2, 3, 8, 9, 10, 11], [0, 2, 4, 5, 8, 10, 12, 13], [0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 6, 8, 10, 11, 12], [0, 1, 2, 4, 8, 9, 10, 12]],
    9: [[0, 1, 2, 4, 5, 6, 8, 9, 10], [0, 1, 2, 3, 4, 8, 9, 10, 11], [0, 1, 2, 3, 4, 8, 9, 10, 11], [0, 2, 4, 6, 8, 10, 12, 13, 14], [0, 1, 2, 4, 6, 8, 10, 12, 14]],
    10: [[0, 1, 2, 4, 5, 6, 8, 9, 10, 12], [0, 1, 2, 4, 5, 6, 8, 9, 10, 13], [0, 1, 2, 3, 4, 8, 9, 10, 11, 12], [0, 1, 2, 3, 4, 8, 9, 10, 11, 12], [0, 2, 4, 6, 8, 10, 12, 13, 14, 15], [0, 1, 2, 4, 5, 6, 8, 10, 12, 14]],
    11: [[0, 1, 2, 3, 4, 8, 9, 10, 11, 12, 14]],
    12: [[0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14]],
};

/**
 * A strafe needs time: the lane cannot change between notes closer than about
 * half a second.  A figure is playable when, cycling bar to bar, no more than
 * MAX_SEGMENT notes sit between two such strafe holes - that is what keeps
 * single-lane runs short.  The hand-written FIGURES are used when they qualify;
 * otherwise every subset of the 16 slots that has the downbeat is searched.
 */
const MAX_SEGMENT = 4;
let SLOT_SEC = 0.15;
const holeSlots = (spb) => Math.ceil(0.5 / (spb / 4));
function playable(slots, hole) {
    const n = slots.length;
    let seg = 1;
    let max = 1;
    let sawHole = false;
    for (let pass = 0; pass < 2; pass += 1) {
        for (let i = 0; i < n; i += 1) {
            const next = i + 1 < n ? slots[i + 1] : 16 + slots[0];
            if (next - slots[i] >= hole) { sawHole = true; seg = 1; } else { seg += 1; max = Math.max(max, seg); }
        }
    }
    // no more than 2 consecutive links inside the 320 ms stop window (cyclic)
    let fastRun = 0;
    let maxFastRun = 0;
    for (let i = 0; i < 2 * n; i += 1) {
        const a = slots[i % n] + (i >= n ? 16 : 0);
        const b = i % n + 1 < n ? slots[i % n + 1] + (i >= n ? 16 : 0) : 16 + slots[0] + (i >= n ? 16 : 0);
        fastRun = (b - a) * SLOT_SEC < 0.32 ? fastRun + 1 : 0;
        maxFastRun = Math.max(maxFastRun, fastRun);
    }
    return sawHole && max <= MAX_SEGMENT && maxFastRun <= 3;
}
const poolCache = new Map();
function figuresFor(count, hole) {
    const key = `${count}/${hole}/${SLOT_SEC}`;
    if (poolCache.has(key)) return poolCache.get(key);
    let pool = (FIGURES[count] || []).filter((f) => playable(f, hole));
    if (pool.length < 6) {
        const have = new Set(pool.map((f) => f.join()));
        let extra = [];
        for (let mask = 0; mask < 1 << 15; mask += 1) {
            const slots = [0];
            for (let i = 0; i < 15; i += 1) if (mask & (1 << i)) slots.push(i + 1);
            if (slots.length === count && playable(slots, hole) && !have.has(slots.join())) extra.push(slots);
        }
        // prefer rhythms that keep the pulse: most notes on the 1/8 grid
        extra = extra.filter((f) => f.filter((v) => v % 2 === 0).length >= Math.ceil(count / 2));
        pool = pool.concat(extra);
    }
    if (!pool.length && count > 2) pool = figuresFor(count - 1, hole);
    poolCache.set(key, pool);
    return pool;
}

/** Lane motifs: lane for beat index i within the phrase (5 lanes). */
const MOTIFS = {
    sweep: (i) => { const p = i % 8; return p < 5 ? p : 8 - p; },
    sweepBack: (i) => { const p = i % 8; return 4 - (p < 5 ? p : 8 - p); },
    stairs: (i) => [0, 1, 1, 2, 2, 3, 3, 4][i % 8],
    pedal: (i) => [2, 0, 2, 4][i % 4],
    pedalEdge: (i) => [0, 2, 0, 3, 4, 2, 4, 1][i % 8],
    zigzag: (i) => [0, 4, 1, 3, 2, 3, 1, 4][i % 8],
    pairs: (i) => [1, 1, 3, 3, 0, 0, 4, 4][i % 8],
    rock: (i) => [1, 2, 3, 2][i % 4],
    wide: (i) => [0, 3, 1, 4, 2, 0, 4, 1][i % 8],
};

/** Section plans; bars must sum to (bars - firstNoteBar - 1). */
const SEC = (n, b, m, mo) => ({ n, b, m, mo });
const PLANS = {
    range: [SEC('intro', 4, 0.6, ['rock', 'pedal']), SEC('verse', 6, 0.9, ['stairs', 'pairs']),
        SEC('build', 4, 1.1, ['zigzag', 'sweep']), SEC('drop', 5, 1.4, ['wide', 'sweepBack', 'pedalEdge']),
        SEC('final', 2, 1.2, ['sweep', 'wide'])],
    drift: [SEC('intro', 4, 0.6, ['pedal', 'rock']), SEC('verse', 7, 0.85, ['stairs', 'pairs', 'rock']),
        SEC('break', 4, 0.6, ['sweep']), SEC('build', 4, 1.1, ['zigzag', 'pedalEdge']),
        SEC('drop', 5, 1.45, ['wide', 'sweepBack', 'zigzag']), SEC('final', 1, 1.2, ['sweep'])],
    neon: [SEC('intro', 4, 0.6, ['pedal', 'pairs']), SEC('verse', 8, 0.9, ['sweep', 'stairs']),
        SEC('build', 4, 1.15, ['zigzag', 'wide']), SEC('drop', 8, 1.4, ['wide', 'pedalEdge', 'sweepBack', 'zigzag']),
        SEC('break', 2, 0.6, ['rock']), SEC('final', 2, 1.35, ['sweep', 'wide', 'pairs'])],
    breakneck: [SEC('intro', 4, 0.6, ['rock', 'pairs']), SEC('verse', 6, 0.9, ['pedalEdge', 'stairs']),
        SEC('build', 4, 1.1, ['zigzag', 'sweep']), SEC('drop', 8, 1.4, ['wide', 'sweepBack', 'pedalEdge']),
        SEC('break', 2, 0.6, ['rock']), SEC('drop2', 5, 1.45, ['zigzag', 'wide', 'sweep']),
        SEC('final', 3, 1.2, ['sweepBack', 'pairs'])],
    vault: [SEC('intro', 4, 0.6, ['pedal', 'rock']), SEC('verse', 6, 0.9, ['stairs', 'pedalEdge']),
        SEC('build', 4, 1.1, ['pairs', 'zigzag']), SEC('drop', 8, 1.4, ['wide', 'sweep', 'pedalEdge']),
        SEC('break', 2, 0.55, ['rock', 'pedal']), SEC('drop2', 8, 1.45, ['zigzag', 'sweepBack', 'wide']),
        SEC('final', 3, 1.2, ['sweep', 'pairs'])],
    overclock: [SEC('intro', 4, 0.6, ['pedal', 'pairs']), SEC('verse', 6, 0.9, ['sweep', 'pedalEdge']),
        SEC('build', 4, 1.1, ['stairs', 'zigzag']), SEC('drop', 8, 1.4, ['wide', 'sweepBack', 'zigzag']),
        SEC('break', 2, 0.55, ['rock', 'pedal']), SEC('drop2', 8, 1.45, ['wide', 'pedalEdge', 'sweep', 'pairs']),
        SEC('final', 7, 1.25, ['zigzag', 'sweepBack', 'wide'])],
};

const BAND = { hard: [2.4, 2.62], expert: [3.25, 3.7] };

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function author(track, difficulty, scale, attempt = 0) {
    const level = buildProceduralChart(track.id, difficulty);
    const plan = PLANS[track.id];
    const planBars = plan.reduce((a, s) => a + s.b, 0);
    if (planBars !== track.bars - track.firstNoteBar - 1) {
        throw new Error(`${track.id}: plan has ${planBars} bars, need ${track.bars - track.firstNoteBar - 1}`);
    }
    const rand = rng(track.seed * 31 + (difficulty === 'expert' ? 7 : 3) + attempt * 977);
    const secPerBeat = 60 / track.bpm;
    SLOT_SEC = secPerBeat / 4;
    const laneW = (level.trackScale * (LAYOUT.trackRight - LAYOUT.trackLeft)) / level.lanes;
    const perBar = (((BAND[difficulty][0] + BAND[difficulty][1]) / 2) * 240) / track.bpm;
    const notes = [];
    let bar = track.firstNoteBar;
    let prevLane = 2;
    let prevBeat = null;
    let run = 0;
    let tailFast = 0;
    let tailSlot = null;
    const used = new Array(level.lanes).fill(0);
    for (const sec of plan) {
        let motif = MOTIFS[sec.mo[0]];
        let beatIdx = 0;
        for (let b = 0; b < sec.b; b += 1, bar += 1) {
            if (b % 2 === 0) { motif = MOTIFS[sec.mo[Math.floor(rand() * sec.mo.length)]]; beatIdx = 0; }
            let count = Math.max(2, Math.min(12, Math.round(perBar * sec.m * scale)));
            if (b === sec.b - 1 && sec.n !== 'final') count = Math.max(2, count - 1);
            const figs = figuresFor(count, holeSlots(secPerBeat));
            const slotSec = secPerBeat / 4;
            const lead = (f) => { let k = 0; while (k + 1 < f.length && (f[k + 1] - f[k]) * slotSec < 0.32) k += 1; return k + (f[0] * slotSec < 0.32 && tailSlot !== null ? 0 : 0); };
            const joinFast = (f) => {
                // fast links chained across the bar line: tail of previous bar + lead of this one
                if (tailSlot === null) return 0;
                const gapJoin = (16 - tailSlot + f[0]) * slotSec;
                return gapJoin < 0.32 ? tailFast + 1 + lead(f) : 0;
            };
            const okFigs = figs.filter((f) => joinFast(f) <= 3);
            const pick = okFigs.length ? okFigs : figs;
            const slots = pick[Math.floor(rand() * pick.length)];
            { let k = 0; for (let i = slots.length - 1; i > 0 && (slots[i] - slots[i - 1]) * slotSec < 0.32; i -= 1) k += 1; tailFast = k; tailSlot = slots[slots.length - 1]; }
            for (const slot of slots) {
                const beat = bar * 4 + slot / 4;
                const bi = beatIdx + Math.floor(slot / 4);
                let lane = Math.min(level.lanes - 1, motif(bi));
                // coverage nudge: every other phrase turn heads for the least-used lane,
                // so no part of the lane space is ignored for a whole chart
                if (bi % 8 >= 4 && notes.length > 20) lane = used.indexOf(Math.min(...used));
                if (prevBeat !== null) {
                    const gap = (beat - prevBeat) * secPerBeat;
                    let dl = lane - prevLane;
                    const reach = CounterStrafeBody.maxDistance(level.movement, gap * 0.8 - 0.04);
                    while (dl !== 0 && Math.abs(dl) * laneW > reach) dl -= Math.sign(dl);
                    lane = prevLane + dl;
                    // never sit in one lane for long: at the next strafe window, step away
                    if (lane === prevLane && run >= 3 && laneW <= reach) {
                        lane = prevLane + (prevLane === 0 ? 1 : prevLane === level.lanes - 1 ? -1 : (rand() < 0.5 ? -1 : 1));
                    }
                }
                run = lane === prevLane ? run + 1 : 1;
                notes.push([beat, lane]);
                used[lane] += 1;
                prevLane = lane;
                prevBeat = beat;
            }
            beatIdx += 4;
        }
    }
    const seconds = (track.bars - track.firstNoteBar) * 4 * secPerBeat;
    return { level, notes, nps: notes.length / seconds };
}

for (const track of tracks) {
    for (const d of ['hard', 'expert']) {
        let scale = 1;
        let out;
        // realise the plan; vary the seed until the chart passes the musical-quality checks
        for (let attempt = 0; attempt < 400; attempt += 1) {
            scale = 0.6;
            out = author(track, d, scale, attempt);
            for (let i = 0; i < 80 && out.nps < BAND[d][0]; i += 1) { scale += 0.02; out = author(track, d, scale, attempt); }
            if (out.nps > BAND[d][1]) continue;
            const probe = { notes: out.notes, lanes: out.level.lanes, bars: track.bars, firstNoteBar: track.firstNoteBar, bpm: track.bpm };
            if (!chartQualityProblems(probe, d).length) break;
            if (attempt === 399) throw new Error(`${track.id}/${d}: no seed passes quality: ${chartQualityProblems(probe, d)}`);
        }
        const file = resolve(root, 'charts', track.id, `${d}.json`);
        const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).chartVersion : track.chartVersion;
        const chart = {
            format: CHART_FORMAT, chartId: out.level.chartId, chartVersion: Math.max(prev + 1, track.chartVersion),
            bpm: track.bpm, bars: track.bars, firstNoteBar: track.firstNoteBar, gridOffset: 0,
            lanes: out.level.lanes, notes: out.notes,
        };
        chart.contentHash = computeContentHash(chart);
        writeFileSync(file, `${JSON.stringify(chart)}\n`);
        console.log(`${chart.chartId} v${chart.chartVersion} ${out.notes.length} notes ${out.nps.toFixed(2)}/s`);
    }
}
