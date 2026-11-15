import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sha256, verifyChart, loadChart, computeContentHash } from '../../src/game/charts/chartLoader.js';
import { resolveChart, TRACKS } from '../../src/game/rules/charts.js';
import { validateRun } from '../../src/game/rules/validateRun.js';
import { BeatMap } from '../../src/game/rules/BeatMap.js';
import { RunRecorder } from '../../src/game/RunRecorder.js';
import { chartQualityProblems } from '../../tools/lib/chart-quality.mjs';
import { playAndRecord } from '../../tools/lib/scripted-player.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const file = (id) => {
    const [, track, diff] = id.split(':');
    return JSON.parse(readFileSync(resolve(root, 'charts', track, `${diff}.json`), 'utf8'));
};

test('sha256 matches node crypto', () => {
    for (const text of ['', 'abc', 'x'.repeat(200), 'héllo ✓']) {
        assert.equal(sha256(text), createHash('sha256').update(text).digest('hex'));
    }
});

test('every Hard and Expert chart of the 6 tracks exists, verifies and loads', () => {
    assert.equal(TRACKS.length, 6);
    for (const t of TRACKS) {
        for (const d of ['hard', 'expert']) {
            const id = `t:${t.id}:${d}`;
            assert.equal(verifyChart(file(id)).ok, true, id);
            assert.equal(loadChart(id).ok, true, id);
            const level = resolveChart(id);
            assert.ok(level.contentHash && level.chartVersion >= 1, id);
            assert.ok(new BeatMap(level).total > 50);
        }
    }
    assert.equal(resolveChart('t:neon:easy').contentHash, undefined, 'easy stays generated');
});

test('tampered hash, tampered notes and old version are rejected by the loader', () => {
    const chart = file('t:neon:hard');
    assert.equal(verifyChart({ ...chart, contentHash: '0'.repeat(64) }).reason, 'chart content hash mismatch');
    const notes = chart.notes.map((n) => n.slice());
    notes[3][0] += 0.25;
    assert.equal(verifyChart({ ...chart, notes }).reason, 'chart content hash mismatch');
    assert.equal(verifyChart({ ...chart, chartVersion: 1 }).ok, false);
    assert.equal(verifyChart(chart, { minVersion: chart.chartVersion + 1 }).reason, 'chart version is outdated');
    // a re-hashed edit is valid on its own, but is a different hash
    const edited = { ...chart, notes };
    edited.contentHash = computeContentHash(edited);
    assert.equal(verifyChart(edited).ok, true);
    assert.notEqual(edited.contentHash, chart.contentHash);
    // a tampered file in an index is not loadable
    assert.equal(loadChart('t:neon:hard', { 't:neon:hard': { ...chart, contentHash: 'bad' } }).ok, false);
});



test('validator accepts a valid run and rejects a tampered hash or old version', () => {
    const chartId = 't:neon:hard';
    const level = resolveChart(chartId);
    const log = {
        version: 5, chartId, movement: { speed: 1, accel: 1 }, startSongTime: -2,
        ticks: Array(60 * 70).fill(16.5), inputs: [], shots: [], look: [],
    };
    const ref = new RunRecorder(chartId).toJSON();
    assert.equal(ref.chartVersion, level.chartVersion);
    assert.equal(ref.chartHash, level.contentHash);

    const good = { ...log, chartVersion: ref.chartVersion, chartHash: ref.chartHash };
    assert.equal(validateRun(level, good).ok, true);

    assert.equal(validateRun(level, { ...good, chartHash: 'f'.repeat(64) }).reason, 'chart hash mismatch');
    assert.equal(validateRun(level, { ...good, chartVersion: good.chartVersion - 1 }).reason, 'chart version mismatch');
    assert.equal(validateRun(level, log).ok, false, 'a log with no chart reference is rejected');
});

test('a valid scored replay on an authored chart is accepted and carries the chart ref', () => {
    const chartId = 't:neon:hard';
    const level = resolveChart(chartId);
    const rec = new RunRecorder(chartId);
    const log = rec.toJSON();
    const out = validateRun(level, { ...log, ticks: Array(60 * 70).fill(16.5) });
    assert.equal(out.ok, true);
    assert.equal(log.chartHash, level.contentHash);
    assert.equal(validateRun(level, { ...log, chartVersion: undefined, ticks: Array(60 * 70).fill(16.5) }).ok, false);
});

test('a scripted run with real hits is accepted, and rejected once its chart ref is tampered', () => {
    const level = { ...resolveChart('t:range:hard') };
    const { record, log } = playAndRecord(level);
    assert.ok(record.notes > 50 && record.score > 0, 'the scripted player hits notes');
    assert.ok(log.shots.length > 50, 'the log contains shots');
    const ok = validateRun(level, log, record.score);
    assert.equal(ok.ok, true, ok.reason);
    assert.equal(ok.record.score, record.score);
    assert.equal(validateRun(level, { ...log, chartHash: '0'.repeat(64) }).reason, 'chart hash mismatch');
    assert.equal(validateRun(level, { ...log, chartVersion: log.chartVersion - 1 }).reason, 'chart version mismatch');
});

test('every authored chartId yields a chart ref; unknown authored ids are flagged unversioned', () => {
    for (const t of TRACKS) {
        for (const d of ['hard', 'expert']) {
            const ref = new RunRecorder(`t:${t.id}:${d}`).chartRef;
            assert.ok(ref && ref.chartVersion >= 1 && ref.contentHash, `${t.id}/${d}`);
        }
    }
    const orig = console.error;
    console.error = () => {};
    try {
        const rec = new RunRecorder('t:nope:hard');
        assert.equal(rec.unversioned, true);
        assert.equal(rec.chartRef, null);
        assert.equal(rec.toJSON().chartVersion, undefined);
    } finally { console.error = orig; }
    assert.equal(new RunRecorder('t:neon:hard').unversioned, false);
    assert.doesNotThrow(() => new RunRecorder('t:neon:easy'), 'generated ids stay unversioned');
});

test('authored charts pass the musical-quality checks (lanes, runs, motifs, phrases, density)', () => {
    for (const t of TRACKS) {
        for (const d of ['hard', 'expert']) {
            const c = file(`t:${t.id}:${d}`);
            assert.deepEqual(chartQualityProblems(c, d), [], `${t.id}/${d}`);
            c.notes.forEach(([b]) => assert.equal(b * 4, Math.round(b * 4), `${t.id}/${d} off-grid ${b}`));
        }
    }
});

test('the quality checker flags a one-lane, repetitive chart', () => {
    const notes = [];
    for (let i = 0; i < 80; i += 1) notes.push([8 + i * 0.5, 2]);
    const bad = { notes, lanes: 5, bars: 24, firstNoteBar: 2, bpm: 90 };
    const problems = chartQualityProblems(bad, 'expert').join(' ');
    assert.match(problems, /lane 0/);
    assert.match(problems, /single-lane run/);
    assert.match(problems, /repeats a motif/);
});

test('a tampered chart file makes the chart unresolvable', () => {
    assert.equal(resolveChart('t:nope:hard'), undefined);
});

test('edge-function copy of the loader and chart bundle is identical', () => {
    const a = resolve(root, 'src/game/charts');
    const b = resolve(root, 'supabase/functions/_shared/charts');
    assert.deepEqual(readdirSync(b).sort(), readdirSync(a).sort());
    for (const f of readdirSync(a)) {
        assert.equal(readFileSync(resolve(b, f), 'utf8').replace(/\r\n/g, '\n'),
            readFileSync(resolve(a, f), 'utf8').replace(/\r\n/g, '\n'), f);
    }
});

test('no long same-lane burst inside the 320 ms stop window, and the checker flags one', () => {
    for (const t of TRACKS) {
        for (const d of ['hard', 'expert']) {
            const c = file(`t:${t.id}:${d}`);
            let fast = 0;
            let max = 0;
            for (let i = 1; i < c.notes.length; i += 1) {
                const close = (c.notes[i][0] - c.notes[i - 1][0]) * (60 / c.bpm) < 0.32 && c.notes[i][1] === c.notes[i - 1][1];
                fast = close ? fast + 1 : 0;
                max = Math.max(max, fast);
            }
            assert.ok(max <= 3, `${t.id}/${d} same-lane burst of ${max + 1}`);
        }
    }
    const burst = { bpm: 120, bars: 40, firstNoteBar: 4, lanes: 5, notes: [] };
    for (let b = 16; b < 160; b += 4) { burst.notes.push([b, 0], [b + 0.25, 0], [b + 0.5, 0], [b + 0.75, 0], [b + 1, 0], [b + 2, 1], [b + 3, 2]); }
    assert.ok(chartQualityProblems(burst, 'expert').some((p) => /burst|rhythm figure/.test(p)));
});
