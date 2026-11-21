import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorialProgress, STAGES, REQUIRED_SUCCESSES, timeSuccess, aimSuccess } from '../../src/game/onboarding/tutorialStages.js';
import { shouldAutoStart, markOnboardingDone, isOnboardingDone, SHORT_CALIBRATION_TAPS, FULL_CALIBRATION_TAPS, calibrationOutcome } from '../../src/game/onboarding/firstRun.js';

const memory = () => {
    const data = new Map();
    return { read: (k, f) => (data.has(k) ? data.get(k) : f), write: (k, v) => { data.set(k, v); return true; } };
};

test('three stages in order: stop, time, aim; initial requirement is 5', () => {
    assert.deepEqual(STAGES.map((s) => s.id), ['stop', 'time', 'aim']);
    assert.equal(REQUIRED_SUCCESSES, 5);
});

test('a stage advances only after the required successes', () => {
    const t = new TutorialProgress();
    for (let i = 0; i < 4; i += 1) assert.equal(t.record('stop', true), 'success');
    assert.equal(t.stage.id, 'stop');
    assert.equal(t.record('stop', true), 'advance');
    assert.equal(t.stage.id, 'time');
    assert.equal(t.count, 0);
});

test('wrong actions never advance and can be repeated; every stage steps back one', () => {
    const t = new TutorialProgress();
    t.record('stop', true); t.record('stop', true);
    assert.equal(t.record('stop', false), 'fail');
    assert.equal(t.count, 1);
    assert.equal(t.failures, 1);
    for (let i = 0; i < 5; i += 1) t.record('stop', true);
    t.record('time', true); t.record('time', true);
    t.record('time', false);
    assert.equal(t.count, 1);
    assert.equal(t.stage.id, 'time');
    t.repeatStage();
    assert.equal(t.count, 0);
});

test('actions for another stage are ignored', () => {
    const t = new TutorialProgress();
    assert.equal(t.record('aim', true), 'ignored');
    assert.equal(t.record('time', false), 'ignored');
    assert.equal(t.count, 0);
    assert.equal(t.failures, 0);
});

test('completing all three stages finishes the tutorial', () => {
    const t = new TutorialProgress(2);
    for (const id of ['stop', 'time']) { t.record(id, true); t.record(id, true); }
    t.record('aim', true);
    assert.equal(t.record('aim', true), 'complete');
    assert.ok(t.complete && t.finished);
    assert.equal(t.record('aim', true), 'ignored');
});

test('skip finishes the tutorial at any step without completing it', () => {
    const t = new TutorialProgress();
    t.skip();
    assert.ok(t.finished);
    assert.ok(!t.complete);
    assert.equal(t.record('stop', true), 'ignored');
});

test('time and aim success rules', () => {
    assert.ok(timeSuccess({ grade: 'perfect' }) && timeSuccess({ grade: 'good' }));
    assert.ok(!timeSuccess({ grade: 'ok' }) && !timeSuccess({ grade: 'miss' }));
    assert.ok(aimSuccess({ grade: 'ok' }) && !aimSuccess({ grade: 'miss' }));
});

test('first-run flag: auto-start on empty storage, never again after skip or completion', () => {
    const empty = memory();
    assert.ok(shouldAutoStart(empty));
    markOnboardingDone(empty, 'skipped');
    assert.ok(isOnboardingDone(empty));
    assert.ok(!shouldAutoStart(empty));
    const other = memory();
    markOnboardingDone(other, 'completed');
    assert.ok(!shouldAutoStart(other));
});

test('automatic calibration is a shortened version of the 16-tap test', () => {
    assert.equal(FULL_CALIBRATION_TAPS, 16);
    assert.ok(SHORT_CALIBRATION_TAPS < FULL_CALIBRATION_TAPS && SHORT_CALIBRATION_TAPS >= 4);
});

test('auto calibration never dead-ends: zero taps still continues, manual retries', () => {
    assert.equal(calibrationOutcome(0, SHORT_CALIBRATION_TAPS, true), 'keep');
    assert.equal(calibrationOutcome(0, FULL_CALIBRATION_TAPS, false), 'retry');
    assert.equal(calibrationOutcome(SHORT_CALIBRATION_TAPS, SHORT_CALIBRATION_TAPS, true), 'apply');
    // Auto path with empty storage: continuing to the tutorial and skipping sets the flag.
    const storage = memory();
    assert.ok(shouldAutoStart(storage));
    assert.equal(calibrationOutcome(0, SHORT_CALIBRATION_TAPS, true) !== 'retry', true);
    markOnboardingDone(storage, 'skipped');
    assert.ok(!shouldAutoStart(storage));
});

test('tutorial runs never award stars even when launched as quickPlay', async () => {
    const { awardsStars } = await import('../../src/game/progress/stars.js');
    assert.equal(awardsStars({ mode: 'quickPlay', difficulty: 'tutorial', speed: 1 }), false);
});

test('game.html keeps the pointer-lock prompt inside the stage and has no page-level capture hint', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
    const stageStart = html.indexOf('id="stage"');
    const prompt = html.indexOf('id="lockPrompt"');
    assert.ok(stageStart > 0 && prompt > stageStart);
    assert.ok(!/click (the game )?to capture/i.test(html.slice(0, stageStart)));
});

import { Calibration } from '../../src/game/screens/Calibration.js';

for (const how of ['applied', 'skipped']) {
    test(`calibration close(${how}) fires onDone once so the tutorial follows`, () => {
        const c = Object.create(Calibration.prototype);
        c.stop = () => {};
        c.overlay = { hidden: false };
        const seen = [];
        c.onDone = (h) => seen.push(h);
        c.close(how);
        c.close(how);
        assert.deepEqual(seen, [how]);
        assert.equal(c.overlay.hidden, true);
    });
}
