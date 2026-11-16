// AC22: timing-error histogram, mean offset and results view model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingHistogram, meanError, describeOffset } from '../../src/game/stats/histogram.js';
import { outlierText } from '../../src/ui/Results.js';
import { buildResultsView } from '../../src/ui/Results.js';

test('mean of early and late errors', () => {
    assert.equal(meanError([-10, -20, 30]), 0);
    assert.equal(meanError([10, 20]), 15);
    assert.equal(meanError([]), 0);
});

test('histogram bins, counts early/late and counts outliers separately', () => {
    const h = timingHistogram([-95, -5, 5, 5, 15, 400, -400]);
    assert.equal(h.bins.length, 20);
    assert.equal(h.count, 7);
    assert.equal(h.bins.reduce((s, b) => s + b.count, 0), 5);
    assert.equal(h.underflow, 1);
    assert.equal(h.overflow, 1);
    assert.equal(h.bins[0].count, 1); // -95 only, not the -400 stray
    assert.equal(h.bins[19].count, 0); // the 400 stray is not folded in
    assert.equal(h.bins[9].count, 1); // [-10, 0)
    assert.equal(h.bins[10].count, 2); // [0, 10)
    assert.equal(h.early, 3);
    assert.equal(h.late, 4);
    assert.equal(h.max, 2);
    assert.equal(outlierText(h), '1 earlier than -100 ms, 1 later than +100 ms');
    assert.equal(outlierText(timingHistogram([5])), '');
});

test('offset text names early or late', () => {
    assert.equal(describeOffset(-12.4), '12 ms early');
    assert.equal(describeOffset(7), '7 ms late');
    assert.equal(describeOffset(0.2), 'on the beat');
});

test('results view carries grade, accuracy, stops, offset and actions', () => {
    const view = buildResultsView({
        record: { rank: 'A', accuracy: 0.876 },
        timingErrorsMs: [10, 20, 30],
        stopQuality: { stopShots: 10, stopGood: 8 },
        stars: [true, true, false],
        mode: 'campaign',
        hasNext: true,
    });
    assert.equal(view.grade, 'A');
    assert.equal(view.accuracyText, '87.6%');
    assert.match(view.offsetText, /20 ms late/);
    assert.equal(view.stopStats.percent, 80);
    assert.deepEqual(view.actions, { retry: true, next: true, menu: true });
    assert.deepEqual(view.stars, [true, true, false]);
});

test('no shots gives a safe view and replays offer no Next', () => {
    const view = buildResultsView({ record: { rank: 'C', accuracy: 0 }, isReplay: true, hasNext: true });
    assert.equal(view.offsetText, 'No shots fired');
    assert.equal(view.stopStats.percent, 0);
    assert.equal(view.actions.next, false);
    assert.equal(view.actions.retry, true);
});

test('a practice run through ResultScreen never reaches the star or submit paths', async () => {
    const { register } = await import('node:module');
    register('../helpers/babylon-hooks.mjs', import.meta.url);
    globalThis.window = globalThis;
    const { ResultScreen } = await import('../../src/game/screens/ResultScreen.js');
    const { ProgressStore } = await import('../../src/game/progress/store.js');
    const { memoryStorage } = await import('../../src/game/atlasHook.js');
    const record = {
        chartId: 't:neon:normal', difficulty: 'normal', rank: 'S', accuracy: 1, score: 1000, completed: true, passed: true,
        perfect: 10, good: 0, loose: 0, missed: 0, bestCombo: 10, counterStrafes: 10, stopShots: 10, stopGood: 10,
    };
    for (const options of [{ runMode: 'practice', speed: 0.75 }, { runMode: 'practice', replay: true }, { runMode: 'quickPlay', replay: true }]) {
        let submits = 0;
        const progress = new ProgressStore(memoryStorage());
        const app = {
            resultOverlay: {},
            services: { progress, onRunComplete: () => { submits += 1; return Promise.resolve({}); } },
        };
        const screen = new ResultScreen(app, record, 't:neon:normal', {}, options);
        assert.equal(screen.routeRewards(), null);
        assert.equal(submits, 0);
        assert.equal(screen.starResult, null);
        assert.equal(progress.total, 0);
        assert.equal(progress.storage.writes, 0);
    }
    // Control: a real Quick Play run does reach both.
    let submits = 0;
    const progress = new ProgressStore(memoryStorage());
    const app = { resultOverlay: {}, services: { progress, onRunComplete: () => { submits += 1; return Promise.resolve({}); } } };
    const screen = new ResultScreen(app, record, 't:neon:normal', {}, { runMode: 'quickPlay' });
    assert.ok(screen.routeRewards());
    assert.equal(submits, 1);
    assert.ok(progress.total > 0);
});
