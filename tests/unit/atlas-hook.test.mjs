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
