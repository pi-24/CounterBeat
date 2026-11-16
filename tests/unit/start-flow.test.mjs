import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestFullscreenFromGesture, lockPromptNeeded } from '../../src/game/onboarding/startFlow.js';
import { rebind, sanitiseBindings, findConflict, strafeDirection, DEFAULT_BINDINGS } from '../../src/game/input/bindings.js';

test('fullscreen is requested synchronously from the gesture handler', () => {
    let calls = 0;
    const stage = { requestFullscreen: () => { calls += 1; return Promise.reject(new Error('refused')); } };
    assert.equal(requestFullscreenFromGesture(stage, {}), true);
    assert.equal(calls, 1, 'requested before any await');
    assert.equal(requestFullscreenFromGesture(stage, { fullscreenElement: {} }), false);
    assert.equal(requestFullscreenFromGesture({}, {}), false);
});

test('lock prompt shows when pointer lock is lost during a live run', () => {
    const live = { conductor: {}, level: {} };
    assert.equal(lockPromptNeeded(live, false), true);
    assert.equal(lockPromptNeeded(live, true), false);
    assert.equal(lockPromptNeeded({ ...live, paused: true }, false), false);
    assert.equal(lockPromptNeeded({ ...live, replay: {} }, false), false);
    assert.equal(lockPromptNeeded(null, false), false);
    assert.equal(lockPromptNeeded({ atlas: {}, level: { tutorial: true } }, false), true);
    assert.equal(lockPromptNeeded({ atlas: {}, level: {} }, false), false);
});

test('arrow-key strafe fallback counts as bound for conflict detection', () => {
    assert.equal(findConflict(DEFAULT_BINDINGS, 'ArrowLeft'), 'strafeLeft');
    for (const action of ['fire', 'strafeRight', 'strafeLeft']) {
        const r = rebind(DEFAULT_BINDINGS, action, 'ArrowRight');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'conflict');
        assert.equal(r.conflict, 'strafeRight');
    }
    assert.deepEqual(sanitiseBindings({ fire: 'ArrowLeft' }), DEFAULT_BINDINGS);
    assert.equal(strafeDirection((c) => c === 'ArrowRight', DEFAULT_BINDINGS), 1);
});

import { resolveRunMode, tutorialNeedsRestart } from '../../src/game/onboarding/startFlow.js';
import { TutorialProgress } from '../../src/game/onboarding/tutorialStages.js';
import { awardsStars } from '../../src/game/progress/stars.js';

test('the tutorial runs in its own mode and can never award stars', () => {
    assert.equal(resolveRunMode({ tutorial: true }, 'quickPlay', 'quickPlay'), 'tutorial');
    assert.equal(resolveRunMode({}, 'campaign', 'quickPlay'), 'campaign');
    assert.equal(resolveRunMode({}, null, 'daily'), 'daily');
    assert.equal(awardsStars({ mode: 'tutorial', difficulty: 'easy', speed: 1, completed: true }), false);
});

test('a tutorial chart that runs out restarts the current stage, not the run', () => {
    const p = new TutorialProgress();
    assert.equal(tutorialNeedsRestart(p), true);
    p.skip();
    assert.equal(tutorialNeedsRestart(p), false);
    assert.equal(tutorialNeedsRestart(null), false);
});
