// Guards the runMode wiring: a full-speed Quick Play run, finished by a real
// PlayScreen and shown by a real ResultScreen, awards stars (and Expert does not).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../helpers/babylon-hooks.mjs', import.meta.url);

globalThis.window = globalThis;
const { PlayScreen } = await import('../../src/game/screens/PlayScreen.js');
const { ResultScreen } = await import('../../src/game/screens/ResultScreen.js');
const { Scorer } = await import('../../src/game/rules/Scorer.js');
const { StopQuality } = await import('../../src/game/progress/stars.js');
const { ProgressStore } = await import('../../src/game/progress/store.js');
const { memoryStorage } = await import('../../src/game/atlasHook.js');

/** Plays out `PlayScreen.finish` with a clean run and returns what it hands to showResults. */
function finishCleanRun(chartId, mode) {
    let handed = null;
    const app = {
        current: null,
        audio: { fadeMusic() {}, play() {} },
        camera: { unlock() {}, lookEnabled: true },
        showResults(...args) { handed = args; },
        services: { progress: new ProgressStore(memoryStorage()) },
    };
    const play = new PlayScreen(app, chartId, { mode });
    app.current = play;
    play.conductor = { stop() {} };
    play.recorder = { toJSON: () => ({ mode, ticks: [], inputs: [], shots: [] }) };
    const level = play.level;
    play.scorer = new Scorer(10);
    for (let i = 0; i < 10; i += 1) {
        play.scorer.apply({ grade: 'perfect', timingError: 0, counterStrafed: true });
    }
    play.stopQuality = new StopQuality();
    for (let i = 0; i < 10; i += 1) {
        play.stopQuality.add(0);
    }
    const original = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { fn(); return 0; };
    try {
        play.finish(true);
    } finally {
        globalThis.setTimeout = original;
    }
    return { app, handed, level };
}

test('Quick Play at full speed on Normal awards three stars through Play -> Result', () => {
    const { app, handed } = finishCleanRun('t:neon:normal', 'quickPlay');
    assert.ok(handed, 'PlayScreen hands the run to showResults');
    const [record, chartId, log, options] = handed;
    assert.equal(options.runMode, 'quickPlay');
    const result = new ResultScreen(app, record, chartId, log, options);
    result.recordStars();
    assert.ok(result.starResult, 'stars were recorded');
    assert.deepEqual(result.starResult.best, [true, true, true]);
    assert.equal(app.services.progress.total, 3);
});

test('Expert awards no stars even for a clean Quick Play run', () => {
    const { app, handed } = finishCleanRun('t:neon:expert', 'quickPlay');
    const [record, chartId, log, options] = handed;
    const result = new ResultScreen(app, record, chartId, log, options);
    result.recordStars();
    assert.equal(result.starResult, null);
    assert.equal(app.services.progress.total, 0);
});
