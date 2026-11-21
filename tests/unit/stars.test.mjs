// AC9: star calculator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateStars, awardsStars, StopQuality, CAMPAIGN_TRACK_IDS, totalStars, mergeBest, STAR_DIFFICULTIES } from '../../src/game/progress/stars.js';
import { ProgressStore } from '../../src/game/progress/store.js';

const run = (o) => ({ difficulty: 'normal', notes: 100, missed: 5, stopShots: 95, stopGood: 0, completed: true, accuracy: 0.9, ...o });

test('rank star boundary: 84.9% no, 85% yes', () => {
    assert.equal(calculateStars(run({ accuracy: 0.849 }))[1], false);
    assert.equal(calculateStars(run({ accuracy: 0.85 }))[1], true);
});

test('pass star uses the difficulty pass accuracy; easy needs only a finish', () => {
    assert.equal(calculateStars(run({ difficulty: 'hard', accuracy: 0.639 }))[0], false);
    assert.equal(calculateStars(run({ difficulty: 'hard', accuracy: 0.64 }))[0], true);
    assert.equal(calculateStars(run({ difficulty: 'normal', accuracy: 0.49 }))[0], false);
    assert.equal(calculateStars(run({ difficulty: 'easy', accuracy: 0.1 }))[0], true);
});

test('challenge: no misses, or >= 80% of shots on a Perfect/Good stop', () => {
    assert.equal(calculateStars(run({ missed: 0, stopGood: 0 }))[2], true);
    assert.equal(calculateStars(run({ stopShots: 100, stopGood: 79 }))[2], false);
    assert.equal(calculateStars(run({ stopShots: 100, stopGood: 80 }))[2], true);
    assert.equal(calculateStars(run({ stopShots: 0, stopGood: 0 }))[2], false);
});

test('challenge reads stop quality, not composite grade: loose timing with perfect stops passes', () => {
    // 30 shots, all on perfect stops, but every one graded Loose overall; 70 notes never shot.
    const r = run({ perfect: 0, good: 0, loose: 30, missed: 70, stopShots: 30, stopGood: 30, accuracy: 0.1 });
    assert.equal(calculateStars(r)[2], true);
    // unshot notes do not dilute the ratio
    assert.equal(calculateStars(run({ notes: 500, stopShots: 10, stopGood: 8 }))[2], true);
});

test('StopQuality counts shots on perfect/good stops by speed', () => {
    const q = new StopQuality();
    for (const speed of [0, 20, 65, 66, 200]) q.add(speed);
    assert.deepEqual([q.stopShots, q.stopGood], [5, 3]);
});

test('expert and unfinished runs award nothing', () => {
    assert.deepEqual(calculateStars(run({ difficulty: 'expert', accuracy: 1 })), [false, false, false]);
    assert.deepEqual(calculateStars(run({ completed: false })), [false, false, false]);
    assert.equal(awardsStars({ mode: 'campaign', difficulty: 'expert' }), false);
});

test('which modes award stars', () => {
    assert.equal(awardsStars({ mode: 'campaign', difficulty: 'hard' }), true);
    assert.equal(awardsStars({ mode: 'quickPlay', difficulty: 'easy', speed: 1 }), true);
    assert.equal(awardsStars({ mode: 'quickPlay', difficulty: 'easy', speed: 0.75 }), false);
    for (const mode of ['practice', 'daily', 'ranked', 'custom']) {
        assert.equal(awardsStars({ mode, difficulty: 'normal' }), false, mode);
    }
});

test('54 campaign stars is the cap: 6 tracks x 3 difficulties x 3', () => {
    const tracks = CAMPAIGN_TRACK_IDS;
    assert.equal(tracks.length, 6);
    const best = {};
    for (const t of tracks) for (const d of STAR_DIFFICULTIES) best[`${t}:${d}`] = [true, true, true];
    best[`${tracks[0]}:expert`] = [true, true, true];
    best['custom-x:easy'] = [true, true, true];
    best[`${tracks[0]}:easy`] = [true, true, true, true];
    assert.equal(totalStars(best), 54);
});

test('ProgressStore keeps best stars, only for star modes, and merges on sync', () => {
    const mem = new Map();
    const storage = { read: (k, f) => mem.get(k) ?? f, write: (k, v) => mem.set(k, JSON.parse(JSON.stringify(v))) };
    const p = new ProgressStore(storage);
    const good = run({ accuracy: 0.9, missed: 0 });
    let r = p.record({ mode: 'campaign', trackId: 'range', difficulty: 'normal' }, good);
    assert.equal(r.newStars, 3);
    r = p.record({ mode: 'campaign', trackId: 'range', difficulty: 'normal' }, run({ accuracy: 0.5, missed: 50, stopGood: 0 }));
    assert.equal(r.newStars, 0);
    assert.equal(p.total, 3);
    p.record({ mode: 'practice', trackId: 'drift', difficulty: 'easy' }, good);
    assert.equal(p.total, 3);
    assert.equal(new ProgressStore(storage).total, 3);
    assert.deepEqual(mergeBest({ 'x:easy': [true, false, false] }, { 'x:easy': [false, true, false] })['x:easy'], [true, true, false]);
});

test('PlayScreen run mode (modeForLevel) awards stars - literal cannot drift', async () => {
    const { modeForLevel } = await import('../../src/game/rules/failout.js');
    const mode = modeForLevel({ kind: 'track' });
    assert.equal(awardsStars({ mode, difficulty: 'normal', speed: 1 }), true);
    assert.equal(awardsStars({ mode, difficulty: 'normal', speed: 0.75 }), false);
    assert.equal(awardsStars({ mode: modeForLevel({ kind: 'daily' }), difficulty: 'hard' }), false);
});

test('unshot notes flagged shotFired:false are not counted by StopQuality gating', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/game/screens/PlayScreen.js', import.meta.url), 'utf8');
    assert.match(src, /shotFired: false/);
    assert.match(src, /judgement\.shotFired !== false/);
});

test('a 0.75x Quick Play run through ProgressStore.record awards nothing', () => {
    const mem = new Map();
    const p = new ProgressStore({ read: (k, f) => mem.get(k) ?? f, write: (k, v) => mem.set(k, v) });
    const slow = p.record({ mode: 'quickPlay', trackId: CAMPAIGN_TRACK_IDS[0], difficulty: 'normal', speed: 0.75 }, run({ accuracy: 0.99, missed: 0 }));
    assert.equal(slow.newStars, 0);
    assert.equal(p.total, 0);
});

test('equipped arena theme and target skin persist in ProgressStore', () => {
    const mem = new Map();
    const p = new ProgressStore({ read: (k, f) => mem.get(k) ?? f, write: (k, v) => mem.set(k, JSON.parse(JSON.stringify(v))) });
    p.equip('theme', 'vault');
    p.equip('targetSkin', 'x');
    const q = new ProgressStore({ read: (k, f) => mem.get(k) ?? f, write: () => {} });
    assert.equal(q.values.equipped.theme, 'vault');
    assert.equal(q.values.equipped.targetSkin, 'x');
});
