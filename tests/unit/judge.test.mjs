// Grading regression net: shot grade = worse of timing and stop grade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Judge } from '../../src/game/rules/Judge.js';
import { GRADE, COUNTER_STRAFE_MEMORY_MS } from '../../src/game/rules/config.js';

const level = { timing: { perfect: 0.03, good: 0.06, ok: 0.1 } };
const lanes = { contains: () => true };
const judge = new Judge(level, lanes);
const note = { time: 10, lane: 0 };

test('speed grades follow 20 / 65 / 140 thresholds', () => {
    assert.equal(judge.gradeSpeed(20), GRADE.PERFECT);
    assert.equal(judge.gradeSpeed(21), GRADE.GOOD);
    assert.equal(judge.gradeSpeed(65), GRADE.GOOD);
    assert.equal(judge.gradeSpeed(66), GRADE.OK);
    assert.equal(judge.gradeSpeed(140), GRADE.OK);
    assert.equal(judge.gradeSpeed(141), GRADE.MISS);
});

test('timing grades are symmetric around the beat', () => {
    assert.equal(judge.gradeTiming(-0.03), GRADE.PERFECT);
    assert.equal(judge.gradeTiming(0.05), GRADE.GOOD);
    assert.equal(judge.gradeTiming(-0.09), GRADE.OK);
    assert.equal(judge.gradeTiming(0.2), GRADE.MISS);
});

test('shot grade is the worse of timing and stop', () => {
    assert.equal(judge.judge(note, 10, 0, 0, true).grade, GRADE.PERFECT);
    assert.equal(judge.judge(note, 10, 0, 100, false).grade, GRADE.OK);
    assert.equal(judge.judge(note, 10.05, 0, 0, true).grade, GRADE.GOOD);
    assert.equal(judge.judge(note, 10.05, 0, 100, true).grade, GRADE.OK);
    assert.equal(judge.judge(note, 10, 0, 300, true).grade, GRADE.MISS);
});

test('an aim miss is always a miss and never counts as counter-strafed', () => {
    const r = judge.judge(note, 10, 0, 0, true, { hit: false, zone: 'none', blocked: false });
    assert.equal(r.grade, GRADE.MISS);
    assert.equal(r.counterStrafed, false);
});

test('headshot needs a non-miss grade', () => {
    assert.equal(judge.judge(note, 10, 0, 0, true, { hit: true, zone: 'head', blocked: false }).headshot, true);
    assert.equal(judge.judge(note, 10, 0, 300, true, { hit: true, zone: 'head', blocked: false }).headshot, false);
});

test('counter-strafe credit window is 320 ms', () => {
    assert.equal(COUNTER_STRAFE_MEMORY_MS, 320);
});
