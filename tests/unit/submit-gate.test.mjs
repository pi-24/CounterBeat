import { test } from 'node:test';
import { LocalBestStore } from '../../src/net/localBest.js';
import { STAR_MODES } from '../../src/game/progress/stars.js';
import { SUBMITTABLE_MODES } from '../../src/net/submit.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canSubmitRankedRun, submitIfRanked } from '../../src/net/submit.js';
import { LocalBackend } from '../../src/core/backend/LocalBackend.js';
import { resolveChart, dailyChartId } from '../../src/game/rules/charts.js';
import { validateRun } from '../../src/game/rules/validateRun.js';
import { playAndRecord } from '../../tools/lib/scripted-player.mjs';

test('Hard and Expert full-speed track runs pass the gate', () => {
    for (const d of ['hard', 'expert']) {
        assert.equal(canSubmitRankedRun({ chartId: `t:range:${d}`, difficulty: d, mode: 'ranked', speed: 1 }).ok, true);
    }
    assert.equal(canSubmitRankedRun({ chartId: dailyChartId('2026-01-02'), mode: 'daily' }).ok, true);
});

test('Easy, Normal, custom, tutorial, practice-speed and bad modes are refused', () => {
    for (const d of ['easy', 'normal']) {
        const r = canSubmitRankedRun({ chartId: `t:range:${d}`, difficulty: d });
        assert.equal(r.ok, false);
        assert.match(r.reason, /Hard and Expert/);
    }
    assert.equal(canSubmitRankedRun({ chartId: 't:range:hard', speed: 0.75 }).ok, false);
    assert.equal(canSubmitRankedRun({ chartId: 't:range:hard', mode: 'practice' }).ok, false);
    assert.equal(canSubmitRankedRun({ chartId: 't:range:hard', mode: 'campaign' }).ok, false);
    assert.equal(canSubmitRankedRun({ chartId: 'custom:x:hard' }).ok, false);
    assert.equal(canSubmitRankedRun({ chartId: 'tutorial' }).ok, false);
    assert.equal(canSubmitRankedRun({ chartId: 't:range:easy', difficulty: 'hard' }).ok, false);
    assert.equal(canSubmitRankedRun(null).ok, false);
});

test('submitIfRanked never calls the backend for Easy/Normal', async () => {
    let calls = 0;
    const backend = { submitRun: async () => { calls += 1; return { saved: true }; } };
    const easy = await submitIfRanked(backend, { chartId: 't:range:easy', difficulty: 'easy', score: 5 }, { mode: 'quickPlay' });
    assert.equal(easy.localOnly, true);
    assert.equal(calls, 0);
    const hard = await submitIfRanked(backend, { chartId: 't:range:hard', difficulty: 'hard', score: 5 }, { mode: 'ranked' });
    assert.equal(hard.saved, true);
    assert.equal(calls, 1);
});

test('server-side replay validation rejects Easy and Normal submissions', () => {
    for (const d of ['easy', 'normal']) {
        const level = resolveChart(`t:range:${d}`);
        const { log, record } = playAndRecord(level, { mode: 'quickPlay' });
        const verdict = validateRun(level, log, record.score);
        assert.equal(verdict.ok, false);
        assert.match(verdict.reason, /ranked needs hard or expert/);
    }
});

test('the edge function uses the gate and its shared copy is identical', () => {
    const fn = readFileSync(new URL('../../supabase/functions/submit-run/index.ts', import.meta.url), 'utf8');
    assert.match(fn, /canSubmitRankedRun/);
    const a = readFileSync(new URL('../../src/net/submit.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const b = readFileSync(new URL('../../supabase/functions/_shared/net/submit.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(b, a, 'run npm run sync-rules');
});

test('LocalBackend keeps an Easy run as a local personal best, unranked', async () => {
    const level = resolveChart('t:range:easy');
    const { log, record } = playAndRecord(level, { mode: 'quickPlay' });
    const backend = Object.create(LocalBackend.prototype);
    backend.currentUser = () => ({ id: 'u1', displayName: 'a' });
    const added = [];
    backend.scores = { personalBest: () => null, add: (r) => { added.push(r); return r; } };
    const result = await backend.submitRun(record, log);
    assert.equal(result.rejected, undefined);
    assert.equal(result.saved, true);
    assert.equal(result.ranked, false);
    assert.equal(result.localOnly, true);
    assert.equal(result.personalBest, true);
    assert.equal(added.length, 1);
    assert.equal(added[0].verified, false, 'never eligible for the leaderboard');
});

test('LocalBackend stores nothing for Practice runs', async () => {
    const level = resolveChart('t:range:easy');
    const { log, record } = playAndRecord(level, { mode: 'practice' });
    const backend = Object.create(LocalBackend.prototype);
    backend.currentUser = () => ({ id: 'u1', displayName: 'a' });
    let added = 0;
    backend.scores = { personalBest: () => null, add: () => { added += 1; } };
    const result = await backend.submitRun(record, log);
    assert.equal(result.saved, false);
    assert.equal(added, 0);
});

test('the run speed is enforced on real submissions', async () => {
    let calls = 0;
    const backend = { submitRun: async () => { calls += 1; return { saved: true }; } };
    const slow = await submitIfRanked(backend, { chartId: 't:range:hard', difficulty: 'hard', score: 5 }, { mode: 'quickPlay', speed: 0.75 });
    assert.equal(slow.localOnly, true);
    assert.equal(calls, 0);
});

test('Daily charts regenerate from their seed and their runs replay-validate', () => {
    const id = dailyChartId('2026-03-04');
    const a = resolveChart(id);
    const b = resolveChart(id);
    assert.deepEqual(a.seed, b.seed);
    const { log, record } = playAndRecord(a, { mode: 'daily' });
    const verdict = validateRun(b, log, record.score);
    assert.equal(verdict.ok, true, verdict.reason);
    assert.equal(verdict.record.score, record.score);
    assert.equal(validateRun(b, { ...log, mode: 'campaign' }, record.score).ok, false);
});

const memory = () => { const m = new Map(); return { read: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), write: (k, v) => { m.set(k, JSON.stringify(v)); return true; } }; };

test('local personal best and pass survive a reload', () => {
    const backing = memory();
    const first = new LocalBestStore(backing, 'u1');
    assert.equal(first.record({ chartId: 't:a:easy', score: 500, passed: true }).personalBest, true);
    assert.equal(first.record({ chartId: 't:a:easy', score: 300, passed: false }).personalBest, false);
    const reloaded = new LocalBestStore(backing, 'u1');
    assert.equal(reloaded.bestOf('t:a:easy'), 500);
    assert.equal(reloaded.hasPassed('t:a:easy'), true);
    assert.equal(new LocalBestStore(backing, 'u2').bestOf('t:a:easy'), 0);
});

test('submittable mode strings match the game loop mode ids', () => {
    assert.ok(STAR_MODES.includes('quickPlay'));
    assert.ok(SUBMITTABLE_MODES.includes('quickPlay'));
    assert.ok(!SUBMITTABLE_MODES.includes('campaign'));
    assert.ok(!SUBMITTABLE_MODES.includes('practice'));
});
