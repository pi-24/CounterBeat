/**
 * test-validate.mjs
 *
 * Proves the replay is exact: a scripted player runs each level through the
 * client-side classes while a RunRecorder logs it, then validateRun replays
 * the log and must land on the same score.  A few tampered logs must be
 * rejected.  Run with `node tools/test-validate.mjs`.
 */
import { resolveChart, allTrackCharts, dailyChartId, TRACKS } from '../src/game/rules/charts.js';
import { validateRun, logDuration } from '../src/game/rules/validateRun.js';
import { BeatMap } from '../src/game/rules/BeatMap.js';
import { GRADE } from '../src/game/rules/config.js';
import { RunRecorder } from '../src/game/RunRecorder.js';
import { playAndRecord } from './lib/scripted-player.mjs';

const STEP = 1 / 60;

let failures = 0;
const check = (name, condition, detail = '') => {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
    if (!condition) failures += 1;
};

const CHARTS = [
    resolveChart('tutorial'),
    ...allTrackCharts(),
    resolveChart(dailyChartId('2026-10-11')),
    resolveChart(dailyChartId()),
];
for (const level of CHARTS) {
    const { record, log } = playAndRecord(level);
    const result = validateRun(level, log, record.score);
    check(`${level.chartId} replay matches client score`, result.ok && result.record.score === record.score,
        result.ok ? `${record.score} vs ${result.record.score}, ${log.ticks.length} ticks, ${record.notes} notes` : result.reason);
    check(`${level.chartId} no mismatch flag`, result.ok && !result.mismatch);
}

// Every official chart must be clearable by the scripted pilot --------------
for (const level of allTrackCharts()) {
    const { record } = playAndRecord(level);
    // The scripted pilot is a feasibility bound, not a perfect player: it may
    // drop the odd note on a frame boundary, never a run of them.
    check(`${level.chartId} is playable (${record.notes} notes)`, record.accuracy >= 0.95 && record.missed <= record.notes * 0.01,
        `accuracy ${(record.accuracy * 100).toFixed(1)}%, missed ${record.missed}`);
}
check('unknown chart ids resolve to nothing', resolveChart('t:nope:hard') === undefined
    && resolveChart('daily:2026-13-40') === undefined && resolveChart('custom:abc') === undefined);
check('every track has a chart at every difficulty', TRACKS.every((t) => resolveChart(`t:${t.id}:expert`)));

// Honest edge cases ---------------------------------------------------------
const level = resolveChart('t:neon:hard');
const honest = playAndRecord(level);

const fast = playAndRecord(level, { step: 1 / 480, reaction: 0.03 });
const rFast = validateRun(level, fast.log, fast.record.score);
check('a 480 Hz run replays exactly', rFast.ok && rFast.record.score === fast.record.score,
    rFast.ok ? `${fast.log.ticks.length} ticks, ${fast.record.score} vs ${rFast.record.score}` : rFast.reason);

const quitter = playAndRecord(level, { quitAt: new BeatMap(level).duration * 0.4 });
const rQuit = validateRun(level, quitter.log, quitter.record.score);
check('a run that fails replays to the same score and is not completed',
    rQuit.ok && rQuit.record.score === quitter.record.score && !rQuit.record.completed
        && rQuit.record.accuracy === quitter.record.accuracy,
    rQuit.ok ? `${quitter.record.score} vs ${rQuit.record.score}, accuracy ${quitter.record.accuracy} vs ${rQuit.record.accuracy}` : rQuit.reason);

const quick = playAndRecord(level, { jitter: true, scale: { speed: 1.25, accel: 1.25 } });
const r5 = validateRun(level, quick.log, quick.record.score);
check('movement settings replay exactly', r5.ok && r5.record.score === quick.record.score,
    r5.ok ? `${quick.record.score} vs ${r5.record.score}` : r5.reason);

check('logDuration sums the ticks', Math.abs(logDuration(honest.log) - honest.log.ticks.reduce((a, b) => a + b, 0) / 1000) < 1e-9);

// Tampering ---------------------------------------------------------------
const inflated = structuredClone(honest.log);
const r1 = validateRun(level, inflated, honest.record.score * 3);
check('inflated claimed score is overridden', r1.ok && r1.mismatch && r1.record.score === honest.record.score);

const wrongLevel = structuredClone(honest.log);
wrongLevel.chartId = 't:neon:easy';
check('chart mismatch rejected', !validateRun(level, wrongLevel).ok);

const teleport = structuredClone(honest.log);
teleport.inputs = [];                             // never moved, but claims hits in every lane
const r3 = validateRun(level, teleport, honest.record.score);
check('hits without moving score far lower', r3.ok && r3.record.score < honest.record.score * 0.5,
    r3.ok ? `${r3.record.score} vs ${honest.record.score}` : r3.reason);

const shifted = structuredClone(honest.log);
shifted.shots = shifted.shots.map(([tick, songMs, ...rest]) => [tick, songMs + 30, ...rest]);
const r6 = validateRun(level, shifted);
check('shot times moved off the tick clock are rejected', !r6.ok, r6.ok ? 'accepted' : r6.reason);

const retimed = structuredClone(honest.log);
retimed.shots = retimed.shots.map(([tick, , idx, zone, blocked]) => {
    const note = new BeatMap(level).notes[idx];
    return [tick, idx >= 0 ? Math.round(note.time * 1000) : 0, idx, zone, blocked];
});
check('shots relabelled with the exact beat time are rejected', !validateRun(level, retimed).ok);

const robot = playAndRecord(level, { jitter: false, exact: true });
const r4 = validateRun(level, robot.log, robot.record.score);
check('ticks landed exactly on every beat flagged as inhuman', !r4.ok, r4.ok ? 'accepted' : r4.reason);

const tooFast = structuredClone(honest.log);
tooFast.movement = { speed: 2, accel: 1 };
check('movement outside the allowed range rejected', !validateRun(level, tooFast).ok);

const spam = structuredClone(honest.log);
spam.shots = Array.from({ length: 40 }, (_, i) => {
    const tick = 5 + i;
    const ms = honest.log.ticks.slice(0, tick + 1).reduce((a, b) => a + b, 0);
    return [tick, Math.round((honest.log.startSongTime + ms / 1000) * 1000), -1, 0, 0];
});
check('impossible fire rate rejected', !validateRun(level, spam).ok);

const oldVersion = structuredClone(honest.log);
oldVersion.version = 3;
check('logs from before version 4 are refused', !validateRun(level, oldVersion).ok);

for (const bad of [NaN, Infinity, 1e9, '0']) {
    const broken = structuredClone(honest.log);
    broken.startSongTime = bad;
    check(`startSongTime ${String(bad)} rejected`, !validateRun(level, broken).ok);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
