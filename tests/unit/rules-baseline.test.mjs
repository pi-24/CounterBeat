// Baseline regression tests for the engine-free rules layer. They pin the
// current (pre-M1) behaviour so later refactors can prove they match it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEED_GRADE } from '../../src/game/rules/config.js';
import {
    DIFFICULTIES, TRACKS, getDifficulty, hashString, dailyChartId, resolveChart, allTrackCharts,
} from '../../src/game/rules/charts.js';

test('speed grade thresholds match the GDD (20 / 65 / 140)', () => {
    assert.equal(SPEED_GRADE.pinPoint, 20);
    assert.equal(SPEED_GRADE.tight, 65);
    assert.equal(SPEED_GRADE.loose, 140);
});

test('four difficulties with strictly tightening windows and rising pass accuracy', () => {
    assert.deepEqual(DIFFICULTIES.map((d) => d.id), ['easy', 'normal', 'hard', 'expert']);
    for (let i = 1; i < DIFFICULTIES.length; i += 1) {
        const a = DIFFICULTIES[i - 1];
        const b = DIFFICULTIES[i];
        assert.ok(b.timing.perfect < a.timing.perfect);
        assert.ok(b.timing.good < a.timing.good);
        assert.ok(b.timing.ok < a.timing.ok);
        assert.ok(b.passAccuracy >= a.passAccuracy);
    }
    assert.equal(getDifficulty('nope'), undefined);
});

test('hashString is stable FNV-1a', () => {
    assert.equal(hashString(''), 0x811c9dc5);
    assert.equal(hashString('a'), 0xe40c292c);
    assert.equal(hashString('2026-01-01'), hashString('2026-01-01'));
});

test('six tracks, each resolvable at every difficulty and deterministic', () => {
    assert.equal(TRACKS.length, 6);
    const charts = allTrackCharts();
    assert.equal(charts.length, 24);
    for (const track of TRACKS) {
        const a = resolveChart(`t:${track.id}:hard`);
        const b = resolveChart(`t:${track.id}:hard`);
        assert.ok(a, track.id);
        assert.equal(JSON.stringify(a), JSON.stringify(b));
    }
});

test('resolveChart rejects unknown ids and builds dailies', () => {
    assert.equal(resolveChart('t:nope:hard'), undefined);
    assert.equal(resolveChart(42), undefined);
    assert.ok(resolveChart(dailyChartId('2026-05-05')));
});
