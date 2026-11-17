// The ?atlas_scene= hook must parse safely and never save progress or submit scores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../helpers/babylon-hooks.mjs', import.meta.url);

const { parseAtlasParams, atlasServices, syntheticRun, memoryStorage } = await import('../../src/game/atlasHook.js');
const { calculateStars } = await import('../../src/game/progress/stars.js');

test('parseAtlasParams reads known scenes and ignores unknown ones', () => {
    assert.deepEqual(parseAtlasParams('?atlas_scene=results&atlas_seed=7'), { scene: 'results', seed: 7, t: 8 });
    assert.equal(parseAtlasParams('?atlas_scene=play&atlas_t=3.5').t, 3.5);
    assert.equal(parseAtlasParams('?atlas_scene=bogus'), null);
    assert.equal(parseAtlasParams(''), null);
});

test('synthetic results run lights the pass, rank and challenge stars', () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 9]) {
        const { record, stopQuality } = syntheticRun(seed);
        assert.deepEqual(calculateStars({ ...record, ...stopQuality }), [true, true, true]);
        assert.ok(record.accuracy >= 0.85);
    }
});

test('atlas services never save progress or submit a run', async () => {
    let remote = 0;
    const services = atlasServices({ onRunComplete: () => { remote += 1; } });
    const { record } = syntheticRun(1);
    const result = await services.onRunComplete(record, {}, null);
    assert.equal(result.saved, false);
    assert.equal(services.startRun('t:neon:normal'), null);
    assert.equal(remote, 0);

    // Recording stars goes to the throwaway in-memory store, not real storage.
    const run = { mode: 'quickPlay', trackId: record.trackId, difficulty: 'normal', speed: 1 };
    services.progress.record(run, { ...record, stopShots: 10, stopGood: 10 });
    assert.ok(services.progress.total > 0);
    assert.ok(services.progress.storage.writes > 0 && services.progress.storage !== globalThis.localStorage);
    assert.equal(services.progress.backend, null);
    assert.equal(typeof memoryStorage().read, 'function');
});

test('practice and results scenes parse; synthetic timing errors are deterministic', async () => {
    const { syntheticTimingErrors } = await import('../../src/game/atlasHook.js');
    assert.equal(parseAtlasParams('?atlas_scene=practice&atlas_seed=1&atlas_t=4').scene, 'practice');
    assert.deepEqual(syntheticTimingErrors(3), syntheticTimingErrors(3));
    assert.equal(syntheticTimingErrors(3).length, 48);
});

test('markAtlasReady waits for the lazy chunks, shaders and streamed audio', async () => {
    const { markAtlasReady } = await import('../../src/game/atlasHook.js');
    const done = [];
    const later = (label, ms) => new Promise((r) => setTimeout(() => { done.push(label); r(); }, ms));
    globalThis.window = {};
    const app = {
        ready3d: later('3d', 10),
        scene: { whenReadyAsync: () => later('shaders', 30) },
        audioStreaming: later('audio', 400),
    };
    const ready = markAtlasReady(app);
    assert.equal(globalThis.window.__atlasReady, undefined, 'not ready while chunks are still loading');
    await ready;
    assert.deepEqual(done, ['3d', 'shaders', 'audio']);
    assert.equal(globalThis.window.__atlasReady, true);
    delete globalThis.window;
});

test('markAtlasReady still signals when a step fails or is missing', async () => {
    const { markAtlasReady } = await import('../../src/game/atlasHook.js');
    globalThis.window = {};
    await markAtlasReady({ ready3d: Promise.reject(new Error('no webgl')), scene: null, audioStreaming: undefined });
    assert.equal(globalThis.window.__atlasReady, true);
    delete globalThis.window;
});

test('atlas_clean is opt-in and only changes the guest wording', async () => {
    const { parseAtlasClean } = await import('../../src/game/atlasHook.js');
    assert.equal(parseAtlasClean('?atlas_scene=play'), false);
    assert.equal(parseAtlasClean('?atlas_scene=play&atlas_clean=1'), true);
    assert.equal(parseAtlasClean('?atlas_clean=0'), false);
    assert.equal(atlasServices({}).isLoggedIn(), false);
    assert.equal(atlasServices({}, { clean: true }).isLoggedIn(), true);
    // still saves and submits nothing in clean mode
    const clean = atlasServices({ onRunComplete: () => assert.fail('submitted') }, { clean: true });
    assert.equal(clean.startRun('t:neon:normal'), null);
    assert.equal((await clean.onRunComplete({ score: 5 })).saved, false);
});

test('the play scene bot records a real, clean run of the chart it shows', async () => {
    const { atlasBotLog, atlasChartId } = await import('../../src/game/atlasHook.js');
    for (const seed of [0, 1, 2, 3]) {
        const log = await atlasBotLog(atlasChartId(seed));
        assert.ok(log, 'bot log');
        assert.equal(log.chartId, atlasChartId(seed));
        assert.ok(log.shots.length > 40, 'it fires at the notes');
        assert.ok(log.ticks.length > 1000);
    }
});
