// AC7: fail-out by mode and difficulty, via simulated all-miss runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failsOut, canFailOut, replayCanFailOut, modeForLevel, FAIL_MODES } from '../../src/game/rules/failout.js';
import { resolveChart } from '../../src/game/rules/charts.js';
import { validateRun } from '../../src/game/rules/validateRun.js';
import { BeatMap } from '../../src/game/rules/BeatMap.js';
import { RULES } from '../../src/game/rules/rules.js';
import { playAndRecord } from '../../tools/lib/scripted-player.mjs';

const DIFFS = ['easy', 'normal', 'hard', 'expert'];
const expected = (mode, diff) => mode !== 'campaign' && (diff === 'hard' || diff === 'expert');

test('failsOut table matches the GDD for every mode and difficulty', () => {
    for (const mode of FAIL_MODES) {
        for (const diff of DIFFS) {
            assert.equal(failsOut(mode, diff), expected(mode, diff), `${mode}/${diff}`);
        }
    }
});

test('failOut flags are read from rules.json', () => {
    for (const diff of DIFFS) {
        assert.equal(RULES.difficulties[diff].failOut.campaign, false);
    }
});

test('the tutorial never fails out', () => {
    assert.equal(canFailOut(resolveChart('tutorial'), 'ranked'), false);
});

test('all-miss runs end (or not) per mode and difficulty - client and server agree', () => {
    for (const mode of FAIL_MODES) {
        for (const diff of DIFFS) {
            const base = resolveChart(`t:neon:${diff}`);
            const level = base;
            const { record, log } = playAndRecord(level, { idle: true, mode });
            const failed = expected(mode, diff);
            assert.equal(record.completed, !failed, `client ${mode}/${diff}`);
            assert.equal(log.mode, mode);
            // The server replays under the mode the log declares; campaign logs
            // are never submitted, and Quick Play only on Hard/Expert.
            const serverLevel = mode === 'daily' ? { ...level, kind: 'daily' } : level;
            const verdict = validateRun(serverLevel, log, record.score);
            if (mode === 'campaign') {
                assert.equal(verdict.ok, false);
                assert.equal(verdict.reason, 'mode not submittable');
                continue;
            }
            if (mode !== 'daily' && !['hard', 'expert'].includes(diff)) {
                assert.equal(verdict.reason, 'ranked needs hard or expert');
                continue;
            }
            assert.ok(verdict.ok, `${mode}/${diff}: ${verdict.reason}`);
            assert.equal(verdict.record.completed, !failed, `server ${mode}/${diff}`);
            if (failed) {
                assert.ok(log.ticks.reduce((a, b) => a + b, 0) / 1000 < new BeatMap(level).duration);
            }
        }
    }
});

test('failsOut is strict for unknown difficulties and rows without a table', () => {
    assert.equal(failsOut('quickPlay', 'nonsense'), true);
    assert.equal(failsOut('campaign', 'nonsense'), false);
});

test('default mode: daily charts are daily, everything else Quick Play', () => {
    assert.equal(modeForLevel({ kind: 'daily' }), 'daily');
    assert.equal(modeForLevel(resolveChart('t:neon:hard')), 'quickPlay');
});

test('v5 replays keep the original fail-out: Hard ending at Focus 0 still ends there', () => {
    const level = resolveChart('t:neon:hard');
    // Recorded as a failing Hard run, then relabelled the way a v5 log looks (no mode).
    const { record, log } = playAndRecord(level, { idle: true, mode: 'ranked' });
    assert.equal(record.completed, false);
    const v5 = { ...log, version: 5 };
    delete v5.mode;
    // Even if the screen would otherwise run it as campaign, a v5 log fails out.
    assert.equal(replayCanFailOut(level, v5, 'campaign'), true);
    assert.equal(replayCanFailOut({ ...level, tutorial: true }, v5, 'campaign'), false);
    // v5 Easy also fails out, as it did when recorded.
    assert.equal(replayCanFailOut(resolveChart('t:neon:easy'), v5, 'campaign'), true);
    // A v6 log obeys its logged mode.
    assert.equal(replayCanFailOut(level, { ...log, mode: 'campaign' }, 'ranked'), false);
});
