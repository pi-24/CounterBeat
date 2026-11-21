// AC10: star-total unlocks and manifest content counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trackStates, cosmeticStates, newlyUnlocked, trackGate } from '../../src/game/progress/unlocks.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const tracks = ['range', 'drift', 'neon', 'breakneck', 'vault', 'overclock'];
const crosshairs = load('crosshairs.json').crosshairs;
const themes = load('themes.json').themes;
const targets = load('targets.json').targets;

test('track gates are 0/3/8/14/21/28', () => {
    assert.deepEqual(tracks.map((_, i) => trackGate(i)), [0, 3, 8, 14, 21, 28]);
});

test('track unlock states at boundary star totals', () => {
    const open = (n) => Object.values(trackStates(tracks, n)).filter((s) => s.unlocked).length;
    assert.equal(open(0), 1);
    assert.equal(open(2), 1);
    assert.equal(open(3), 2);
    assert.equal(open(7), 2);
    assert.equal(open(8), 3);
    assert.equal(open(14), 4);
    assert.equal(open(21), 5);
    assert.equal(open(27), 5);
    assert.equal(open(28), 6);
});

test('content minimums: >=10 crosshairs, 3 themes, 15 target skins (5 bots x 3)', () => {
    assert.ok(crosshairs.length >= 10);
    assert.equal(themes.length, 3);
    assert.equal(targets.length, 15);
});

test('cosmetics unlock exactly at their starCost, and something is free', () => {
    for (const list of [crosshairs, themes, targets]) {
        assert.ok(list.some((e) => e.starCost === 0));
        for (const e of list) {
            assert.equal(typeof e.starCost, 'number');
            assert.equal(cosmeticStates([e], e.starCost)[0].unlocked, true);
            if (e.starCost > 0) {
                assert.equal(cosmeticStates([e], e.starCost - 1)[0].unlocked, false);
            }
        }
    }
});

test('newlyUnlocked reports tracks and cosmetics crossed', () => {
    const ids = newlyUnlocked(tracks, { crosshair: crosshairs }, 2, 4);
    assert.ok(ids.includes('track:drift'));
    assert.ok(ids.includes('crosshair:xh-gap-cross'));
    assert.ok(!ids.includes('track:neon'));
});
