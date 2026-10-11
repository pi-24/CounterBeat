/**
 * test-validate.mjs
 *
 * Proves the replay is exact: a scripted player runs each level through the
 * client-side classes while a RunRecorder logs it, then validateRun replays
 * the log and must land on the same score.  A few tampered logs must be
 * rejected.  Run with `node tools/test-validate.mjs`.
 */
import { resolveChart, allTrackCharts, dailyChartId, TRACKS } from '../src/game/rules/charts.js';
import { BeatMap } from '../src/game/rules/BeatMap.js';
import { CounterStrafeBody } from '../src/game/rules/CounterStrafeBody.js';
import { Judge } from '../src/game/rules/Judge.js';
import { Scorer } from '../src/game/rules/Scorer.js';
import { SPEED_GRADE, GRADE, APPROACH_BEATS } from '../src/game/rules/config.js';
import { validateRun } from '../src/game/rules/validateRun.js';
import { RunRecorder } from '../src/game/RunRecorder.js';

const STEP = 1 / 60;

function pilot(body, targetX) {
    const gap = targetX - body.x;
    const v = body.velocity;
    // Look one frame ahead: if accelerating once more would overshoot, brake now.
    const ahead = v + Math.sign(gap) * body.movement.accel * STEP;
    const braking = (ahead * ahead) / (2 * body.movement.counterDecel);
    if (Math.abs(gap) < 6 && Math.abs(v) < SPEED_GRADE.pinPoint) return 0;
    if (v !== 0 && Math.sign(v) === Math.sign(gap) && braking >= Math.abs(gap)) return -Math.sign(v);
    return Math.sign(gap);
}

/** Plays a level the way PlayScreen does, with slightly irregular frames. */
function playAndRecord(level, aimZone = 'head', jitter = true) {
    const beatMap = new BeatMap(level);
    const lanes = beatMap.lanes;
    const judge = new Judge(level, lanes);
    const scorer = new Scorer(beatMap.total);
    const recorder = new RunRecorder(level.chartId);
    const body = new CounterStrafeBody(level.movement,
        { min: lanes.left + 16, max: lanes.right - 16 }, lanes.centre(Math.floor(level.lanes / 2)));
    const lead = APPROACH_BEATS * (60 / level.bpm);

    let songTime = -0.05;
    let clockMs = 0;
    let seed = level.seed;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    while (songTime < beatMap.duration) {
        const dt = jitter ? STEP * (0.7 + rand() * 0.6) : STEP;
        const next = beatMap.notes.find((n) => !n.resolved);
        const dir = next ? pilot(body, lanes.centre(next.lane)) : 0;
        clockMs = recorder.tick(dt, dir, songTime);
        const stored = recorder.ticks[recorder.ticks.length - 1] / 1000;
        body.setInput(dir);
        body.update(stored, clockMs);
        songTime = (recorder.startSongTime ?? songTime) + clockMs / 1000;
        for (const note of beatMap.notes) {
            if (!note.spawned && !note.resolved && note.time - songTime <= lead) note.spawned = true;
        }
        // Fire on the first frame at or after the beat, if we are in the lane.
        if (next && next.spawned && songTime >= next.time) {
            const inLane = lanes.contains(next.lane, body.x);
            const zone = inLane ? aimZone : 'none';
            recorder.shot(songTime, inLane ? next.index : -1, zone, !inLane);
            const judgement = judge.judge(next, songTime, body.x, body.speed, body.isPlanted(clockMs),
                { hit: inLane, zone, blocked: !inLane });
            next.resolved = true;
            scorer.apply(judgement);
        }
        for (const note of beatMap.notes) {
            if (note.spawned && !note.resolved && songTime > note.time + level.timing.ok) {
                note.resolved = true;
                scorer.apply({ grade: GRADE.MISS, timingError: songTime - note.time, speed: body.speed,
                    inLane: false, counterStrafed: false, headshot: false, reason: 'No shot' });
            }
        }
    }
    const record = scorer.toRecord(level, true);
    return { record, log: recorder.toJSON() };
}

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

// Tampering ---------------------------------------------------------------
const level = resolveChart('t:neon:hard');
const honest = playAndRecord(level);

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

const robot = playAndRecord(level, 'head', false);
robot.log.shots = robot.log.shots.map(([tick, , idx, zone, blocked]) => {
    const note = new BeatMap(level).notes[idx];
    return [tick, idx >= 0 ? Math.round(note.time * 1000) : 0, idx, zone, blocked];
});
const r4 = validateRun(level, robot.log, 0);
check('perfectly timed shots flagged as inhuman', !r4.ok, r4.ok ? 'accepted' : r4.reason);

const spam = structuredClone(honest.log);
spam.shots = Array.from({ length: 40 }, (_, i) => [5 + i, Math.round((honest.log.startSongTime + 0.1 + i * 0.016) * 1000), -1, 0, 0]);
check('impossible fire rate rejected', !validateRun(level, spam).ok);

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
