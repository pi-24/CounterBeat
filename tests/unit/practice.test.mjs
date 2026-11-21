// AC11: practice rules and the reward gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PRACTICE_SPEED, earnsRewards, chartPlayable, routeRunResult, normaliseSection,
    sectionTimes, notesInSection, LiveTimingReadout,
} from '../../src/game/modes/practice.js';

test('practice runs at 0.75x', () => assert.equal(PRACTICE_SPEED, 0.75));

test('practice result is never passed to the star or submit functions', () => {
    let stars = 0;
    let submits = 0;
    const handlers = { onStars: () => { stars += 1; }, onSubmit: () => { submits += 1; return true; } };
    assert.equal(routeRunResult('practice', handlers), false);
    assert.deepEqual([stars, submits], [0, 0]);
    assert.equal(routeRunResult('campaign', handlers), true);
    assert.deepEqual([stars, submits], [1, 1]);
    assert.equal(earnsRewards('practice'), false);
    assert.equal(earnsRewards('quickPlay'), true);
});

test('practice plays every chart regardless of unlocks', () => {
    assert.equal(chartPlayable('practice', false), true);
    assert.equal(chartPlayable('campaign', false), false);
    assert.equal(chartPlayable('quickPlay', true), true);
});

test('sections are normalised, ordered and need a minimum length', () => {
    assert.deepEqual(normaliseSection({ startBeat: 20.4, endBeat: 8 }, 100), { startBeat: 8, endBeat: 20 });
    assert.equal(normaliseSection({ startBeat: 8, endBeat: 10 }, 100), null);
    assert.equal(normaliseSection(null, 100), null);
    assert.deepEqual(normaliseSection({ startBeat: -5, endBeat: 500 }, 64), { startBeat: 0, endBeat: 64 });
});

test('section times and note filtering', () => {
    const t = sectionTimes({ startBeat: 4, endBeat: 8 }, 0.5, 1);
    assert.deepEqual(t, { start: 3, end: 5 });
    const notes = [{ time: 2 }, { time: 3 }, { time: 4.5 }, { time: 6 }];
    assert.deepEqual(notesInSection(notes, t.start, t.end), [{ time: 3 }, { time: 4.5 }]);
});

test('live readout tracks last and rolling average', () => {
    const r = new LiveTimingReadout(2);
    assert.match(r.text(), /fire/);
    r.add(-10);
    r.add(20);
    r.add(40);
    assert.equal(r.average, 30);
    assert.match(r.text(), /Last 40 ms late · avg 30 ms late/);
});

import { isPractice, CLEAR_KEY, applySection, recordLoopPass, loopSummaryText, realTimeErrorMs, practiceHintText, practiceKeyFree, LiveTimingReadout as LTR } from '../../src/game/modes/practice.js';

test('practice timing errors are real-time ms and non-finite shots are dropped', () => {
    assert.equal(realTimeErrorMs(0.015, 0.75), 20);
    assert.equal(realTimeErrorMs(0.02), 20);
    assert.equal(realTimeErrorMs(undefined, 0.75), null);
    assert.equal(realTimeErrorMs(NaN), null);
    const r = new LTR();
    r.add(NaN);
    assert.equal(r.last, null);
    r.add(10);
    assert.equal(r.average, 10);
});

test('practice hint renders the exact string with a literal backslash', () => {
    assert.equal(CLEAR_KEY.length, 1);
    assert.equal(CLEAR_KEY.charCodeAt(0), 92);
    assert.equal(practiceHintText({ section: null, pendingStartBeat: null, readoutText: 'x' }),
        'Practice 0.75× · No loop · x (ms at 0.75×)');
    assert.equal(practiceHintText({ section: { startBeat: 4, endBeat: 12 }, pendingStartBeat: 2, readoutText: 'x', showLegend: true }),
        'Practice 0.75× · Loop 4-12 (start 2) · [ start · ] end · ' + String.fromCharCode(92) + ' clear · Enter finish');
});

test('practice keys respect rebinding conflicts', () => {
    assert.equal(practiceKeyFree('Backslash', { left: 'KeyA', fire: 'Mouse0' }), true);
    assert.equal(practiceKeyFree('Backslash', { left: 'KeyA', fire: 'Backslash' }), false);
    assert.equal(practiceKeyFree('KeyA', {}), false);
});

import { DIFFICULTIES, resolveChart, TRACKS } from '../../src/game/rules/charts.js';
import { BeatMap } from '../../src/game/rules/BeatMap.js';
import { resolveRunMode } from '../../src/game/onboarding/startFlow.js';
import { AudioEngine } from '../../src/game/audio/AudioEngine.js';

test('every track and difficulty, Expert included, is practice-playable on a zero-star profile', () => {
    assert.ok(DIFFICULTIES.some((d) => d.id === 'expert'), 'Expert must exist');
    assert.deepEqual(DIFFICULTIES.map((d) => d.id), ['easy', 'normal', 'hard', 'expert']);
    assert.equal(TRACKS.length, 6);
    for (const t of TRACKS) {
        for (const d of DIFFICULTIES) {
            assert.ok(resolveChart(`t:${t.id}:${d.id}`), `${t.id}:${d.id}`);
            assert.equal(chartPlayable('practice', false), true);
        }
    }
});

test('an 8-beat loop leaves only the section notes for the scorer and HUD total', () => {
    const level = resolveChart('t:neon:normal');
    const full = new BeatMap(level);
    const map = new BeatMap(level);
    const spb = map.secondsPerBeat;
    const grid = level.gridOffset ?? 0;
    const { section, startSeconds } = applySection(map, { startBeat: 16, endBeat: 24 }, grid, 2 * spb);
    assert.deepEqual(section, { startBeat: 16, endBeat: 24 });
    assert.ok(map.total > 0 && map.total < full.total);
    assert.ok(map.total <= 9, `8 beats must not hold more than 9 bots, got ${map.total}`);
    for (const n of map.notes) {
        assert.ok(n.time >= grid + 16 * spb - 1e-3 && n.time <= grid + 24 * spb + 1e-3);
    }
    assert.ok(startSeconds > 0 && startSeconds < grid + 16 * spb);
    assert.equal(new Scorer(map.total).judged, 0);
    const none = applySection(new BeatMap(level), { startBeat: 3, endBeat: 4 }, grid, 0);
    assert.deepEqual(none, { section: null, startSeconds: 0 });
});

import { Scorer } from '../../src/game/rules/Scorer.js';

test('a practice run stays practice through restart and loop, at 0.75x, and never rewards', () => {
    const level = resolveChart('t:neon:hard');
    const mode = resolveRunMode(level, 'practice', 'quickPlay');
    assert.equal(mode, 'practice');
    // restart / loop / next re-resolve the same mode
    assert.equal(resolveRunMode(level, mode, 'quickPlay'), 'practice');
    assert.equal(resolveRunMode(resolveChart('t:neon:easy'), mode, 'quickPlay'), 'practice');
    // PlayScreen derives its practice flag (speed) from the resolved mode, so speed and rewards cannot split
    assert.equal(resolveRunMode(level, 'practice', 'ranked'), 'practice');
    assert.equal(isPractice(resolveRunMode(level, 'ranked', 'practice')), false);
    assert.equal(PRACTICE_SPEED, 0.75);
    let calls = 0;
    const h = { onStars: () => { calls += 1; }, onSubmit: () => { calls += 1; return true; } };
    for (let i = 0; i < 3; i += 1) assert.equal(routeRunResult(mode, h), false);
    assert.equal(calls, 0);
    assert.equal(routeRunResult(resolveRunMode(level, 'ranked', 'quickPlay'), h), true);
    assert.equal(calls, 2);
});

test('loop pass stats are kept per pass and summarised', () => {
    const s = new Scorer(4);
    const passes = recordLoopPass([], s);
    const more = recordLoopPass(passes, { accuracy: 0.75, judged: 8 });
    assert.equal(passes.length, 1);
    assert.equal(more.length, 2);
    assert.equal(loopSummaryText(more), 'Loop passes: 1: 0%, 2: 75%');
    assert.equal(loopSummaryText([]), '');
});

test('music song time advances at 0.75x from t=0 with no start offset', () => {
    let clock = 10;
    const started = [];
    const context = {
        currentTime: 10, state: 'running',
        createGain: () => ({ gain: {}, connect() {} }),
        createBufferSource: () => ({
            playbackRate: { value: 1, setValueAtTime() {} }, connect() {}, disconnect() {},
            start: (...a) => started.push(a), stop() {},
        }),
    };
    const audio = new AudioEngine();
    audio.context = context;
    audio.musicGain = {};
    audio.buffers.set('k', {});
    audio.clockTime = () => clock;
    audio.playMusic('k', false, 0, 0.75);
    assert.equal(audio.musicSource.playbackRate.value, 0.75);
    assert.equal(audio.musicRate, 0.75);
    const startAt = audio.musicAnchorClock;
    clock = startAt;
    assert.equal(audio.musicPosition, 0);
    clock = startAt + 4;
    assert.equal(audio.musicPosition, 3);
    // a section start offset is in track time and the rate still applies
    audio.playMusic('k', false, 20, 0.75);
    clock = audio.musicAnchorClock + 4;
    assert.equal(audio.musicPosition, 23);
});

import { failsOut } from '../../src/game/rules/failout.js';
test('practice never fails out on any difficulty (GDD: Practice has no fail-out)', () => {
    for (const d of DIFFICULTIES) {
        assert.equal(failsOut('practice', d.id), false, d.id);
    }
    assert.equal(failsOut('ranked', 'expert'), true); // control: the table still bites elsewhere
});

import { replayCanFailOut } from '../../src/game/rules/failout.js';
test('PlayScreen.checkFailure path: a live practice run on Expert cannot fail out', () => {
    const level = resolveChart('t:neon:expert');
    assert.equal(replayCanFailOut(level, null, 'practice'), false);
    assert.equal(replayCanFailOut(level, null, 'ranked'), true);
});

test('a section with no notes is ignored instead of restarting forever', () => {
    const level = resolveChart('t:neon:normal');
    const map = new BeatMap(level);
    const spb = map.secondsPerBeat;
    const grid = level.gridOffset ?? 0;
    // Remove every note in beats 16-24 to model a silent stretch of the chart.
    map.notes = map.notes.filter((n) => n.time < grid + 15.5 * spb || n.time > grid + 24.5 * spb);
    const before = map.notes.length;
    const res = applySection(map, { startBeat: 16, endBeat: 24 }, grid, 0);
    assert.deepEqual(res, { section: null, startSeconds: 0 });
    assert.equal(map.notes.length, before, 'the chart is left whole');
});
