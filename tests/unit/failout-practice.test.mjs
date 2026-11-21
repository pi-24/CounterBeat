import test from 'node:test';
import assert from 'node:assert/strict';
import { failsOut } from '../../src/game/rules/failout.js';

test('practice and unknown modes never fail out, on any difficulty', () => {
    for (const d of ['easy', 'normal', 'hard', 'expert']) {
        assert.equal(failsOut('practice', d), false, `practice ${d}`);
        assert.equal(failsOut('somethingNew', d), false, `unknown ${d}`);
    }
    assert.equal(failsOut('ranked', 'hard'), true);
    assert.equal(failsOut('quickPlay', 'expert'), true);
});
