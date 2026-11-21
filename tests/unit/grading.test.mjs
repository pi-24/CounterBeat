// AC5: stop grading thresholds, 320 ms window and worst-of rule on all four difficulties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Judge } from '../../src/game/rules/Judge.js';
import { DIFFICULTIES } from '../../src/game/rules/charts.js';
import { GRADE, COUNTER_STRAFE_MEMORY_MS, SPEED_GRADE } from '../../src/game/rules/config.js';
import {
    gradeStop, gradeShot, STOP_SPEED, COUNTER_STRAFE_WINDOW_MS, RULES,
} from '../../src/game/rules/rules.js';

const lanes = { contains: () => true };
const note = { time: 10, lane: 0 };

test('shared constants are 20 / 65 / 140 and 320 ms', () => {
    assert.deepEqual({ ...STOP_SPEED }, { perfect: 20, good: 65, loose: 140 });
    assert.equal(COUNTER_STRAFE_WINDOW_MS, 320);
    assert.equal(COUNTER_STRAFE_MEMORY_MS, 320);
    assert.equal(SPEED_GRADE.pinPoint, 20);
});

test('gradeStop boundaries', () => {
    const cases = [[0, 'perfect'], [20, 'perfect'], [20.01, 'good'], [65, 'good'], [65.01, 'ok'],
        [140, 'ok'], [140.01, 'miss'], [600, 'miss']];
    for (const [speed, grade] of cases) {
        assert.equal(gradeStop(speed), grade, `speed ${speed}`);
    }
});

for (const difficulty of DIFFICULTIES) {
    test(`${difficulty.id}: stop grades identical, shot grade is the worse of timing and stop`, () => {
        const judge = new Judge({ timing: difficulty.timing }, lanes);
        const t = difficulty.timing;
        for (const [speed, grade] of [[20, 'perfect'], [21, 'good'], [65, 'good'], [66, 'ok'], [140, 'ok'], [141, 'miss']]) {
            assert.equal(judge.gradeSpeed(speed), grade);
            // perfect timing: shot grade equals the stop grade
            assert.equal(judge.judge(note, 10, 0, speed, true).grade, grade);
            assert.equal(gradeShot(0, speed, t), grade);
        }
        // timing boundaries with a perfect stop
        assert.equal(gradeShot(t.perfect, 0, t), GRADE.PERFECT);
        assert.equal(gradeShot(t.perfect + 0.001, 0, t), GRADE.GOOD);
        assert.equal(gradeShot(-t.good, 0, t), GRADE.GOOD);
        assert.equal(gradeShot(t.good + 0.001, 0, t), GRADE.OK);
        assert.equal(gradeShot(t.ok, 0, t), GRADE.OK);
        assert.equal(gradeShot(t.ok + 0.001, 0, t), GRADE.MISS);
        // worse of the two wins either way round
        assert.equal(gradeShot(t.good, 10, t), GRADE.GOOD);
        assert.equal(gradeShot(0, 100, t), GRADE.OK);
        assert.equal(gradeShot(t.ok, 100, t), GRADE.OK);
        assert.equal(gradeShot(t.good, 100, t), GRADE.OK);
        assert.equal(gradeShot(t.ok + 0.01, 0, t), GRADE.MISS);
    });
}

test('rules.json has the required fields per difficulty', () => {
    for (const id of ['easy', 'normal', 'hard', 'expert']) {
        const r = RULES.difficulties[id];
        for (const key of ['notesPerSecond', 'timing', 'hitboxScale', 'spreadScale', 'failOut', 'passAccuracy']) {
            assert.ok(key in r, `${id}.${key}`);
        }
        for (const mode of ['campaign', 'quickPlay', 'daily', 'ranked']) {
            assert.equal(typeof r.failOut[mode], 'boolean');
        }
        assert.equal(r.failOut.campaign, false);
    }
    assert.equal(RULES.difficulties.hard.failOut.ranked, true);
    assert.equal(RULES.difficulties.easy.failOut.quickPlay, false);
});
