import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCALES, pitchFor, inScale, hitPitch, patternIndex, midiToHz } from '../../src/game/audio/hitSounds.js';
import { Settings } from '../../src/game/Settings.js';
import { DEFAULT_SETTINGS } from '../../src/game/rules/config.js';

const tracks = JSON.parse(readFileSync(new URL('../../data/tracks.json', import.meta.url))).tracks;

test('every track has a root note and a known scale', () => {
    assert.ok(tracks.length >= 6);
    for (const t of tracks) {
        assert.ok(t.key && SCALES[t.scale], `${t.id} needs key and scale`);
    }
});

test('every mapped pitch (lane and pattern, headshot octave) is in the track scale', () => {
    for (const t of tracks) {
        for (let lane = 0; lane < 12; lane++) {
            for (const mode of ['lane', 'pattern']) {
                const { midi } = hitPitch(t, { lane, noteIndex: lane * 3 + 1, mode });
                assert.ok(inScale(midi, t.key, t.scale), `${t.id} ${mode} ${lane}`);
                assert.ok(inScale(midi + 12, t.key, t.scale));
            }
        }
    }
});

test('pitch helpers', () => {
    assert.equal(pitchFor('C', 'minor-pentatonic', 0, 4), 60);
    assert.equal(pitchFor('C', 'minor-pentatonic', 5, 4), 72);
    assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
    assert.equal(inScale(61, 'C', 'minor-pentatonic'), false);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => patternIndex(i, 5)), [0, 1, 2, 3, 4, 3, 2, 1, 0]);
    assert.throws(() => pitchFor('H', 'minor', 0));
});

test('hit volume and plain hit sounds are sanitised and persisted', () => {
    const mem = {};
    const storage = { read: (k, d) => mem[k] ?? d, write: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
    const s = new Settings(storage);
    assert.equal(s.get('hitVolume'), DEFAULT_SETTINGS.hitVolume);
    s.update({ hitVolume: 7, plainHitSounds: true, reducedEffects: true });
    assert.equal(s.get('hitVolume'), 1);
    const reloaded = new Settings(storage);
    assert.equal(reloaded.get('plainHitSounds'), true);
    assert.equal(reloaded.get('reducedEffects'), true);
    assert.equal(reloaded.get('hitVolume'), 1);
});

test('non-finite indices never produce NaN pitches', () => {
    for (const mode of ['lane', 'pattern']) {
        for (const bad of [undefined, NaN, Infinity, -3]) {
            const { midi, hz } = hitPitch(tracks[0], { lane: bad, noteIndex: bad, mode });
            assert.ok(Number.isFinite(midi) && Number.isFinite(hz) && hz > 0, `${mode} ${bad}`);
        }
    }
});

test('pitch is clamped to two octaves and always finite', () => {
    const top = pitchFor('C', 'minor-pentatonic', 99, 4);
    assert.ok(top <= 60 + 12 + 12);
    assert.ok(Number.isFinite(pitchFor('C', 'minor', NaN, 4)));
    assert.ok(Number.isFinite(hitPitch({ key: 'D', scale: 'minor' }, { lane: 2, noteIndex: NaN, mode: 'pattern' }).hz));
});
