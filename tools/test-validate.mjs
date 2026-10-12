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
import { validateRun, logDuration } from '../src/game/rules/validateRun.js';
import { RunRecorder } from '../src/game/RunRecorder.js';

const STEP = 1 / 60;

function pilot(body, targetX, step) {
    const gap = targetX - body.x;
    const v = body.velocity;
    // Look one frame ahead: if accelerating once more would overshoot, brake now.
    const ahead = CounterStrafeBody.step(body.movement, v, Math.sign(gap), step);
    const braking = CounterStrafeBody.brakingDistance(body.movement, ahead);
    if (Math.abs(gap) < 6 && Math.abs(v) < SPEED_GRADE.pinPoint) return 0;
    if (v !== 0 && Math.sign(v) === Math.sign(gap) && braking >= Math.abs(gap)) return -Math.sign(v);
    return Math.sign(gap);
}

/**
 * Plays a level the way PlayScreen does - per tick: inputs, movement, spawn,
 * expire, then the shot - with slightly irregular frames.
 * @param {object} level
 * @param {object} [options]
 * @param {'head'|'body'} [options.aimZone]
 * @param {boolean} [options.jitter] irregular frame lengths
 * @param {{speed:number, accel:number}} [options.scale] movement settings
 * @param {number} [options.step] nominal frame length, seconds
 * @param {boolean} [options.exact] shorten frames so a tick lands exactly on each beat (a bot)
 * @param {boolean} [options.idle] never move or shoot (focus runs out)
 * @param {number} [options.quitAt] play properly until this song time, then go idle
 * @param {number} [options.reaction] fire up to this many seconds after the beat, varying per
 *   note like a human would (at high frame rates "first tick after the beat" is bot-precise)
 */
function playAndRecord(level, options = {}) {
    const {
        aimZone = 'head', jitter = true, scale = { speed: 1, accel: 1 }, step = STEP,
        exact = false, reaction = 0,
    } = options;
    const beatMap = new BeatMap(level);
    const lanes = beatMap.lanes;
    const judge = new Judge(level, lanes);
    const scorer = new Scorer(beatMap.total);
    const recorder = new RunRecorder(level.chartId, scale);
    const body = new CounterStrafeBody(CounterStrafeBody.scaled(level.movement, scale),
        { min: lanes.left + 16, max: lanes.right - 16 }, lanes.centre(Math.floor(level.lanes / 2)));
    const lead = APPROACH_BEATS * (60 / level.bpm);

    let songTime = -0.05;
    let clockMs = 0;
    let seed = level.seed;
    let failed = false;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    const quitAt = options.quitAt ?? Number.POSITIVE_INFINITY;
    while (songTime < beatMap.duration && !failed) {
        const idle = options.idle || songTime > quitAt;
        let dt = jitter ? step * (0.7 + rand() * 0.6) : step;
        const next = beatMap.nextNote;
        if (exact && next && songTime < next.time && songTime + dt > next.time) {
            dt = Math.max(0.0005, next.time - songTime);
        }
        const dir = next && !idle ? pilot(body, lanes.centre(next.lane), step) : 0;
        clockMs = recorder.tick(dt, dir, songTime);
        const stored = recorder.ticks[recorder.ticks.length - 1] / 1000;
        body.setInput(dir);
        body.update(stored, clockMs);
        songTime = (recorder.startSongTime ?? songTime) + clockMs / 1000;

        beatMap.spawnDue(songTime, lead);
        beatMap.expireDue(songTime, level.timing.ok, (note) => {
            note.resolved = true;
            scorer.apply({ grade: GRADE.MISS, timingError: songTime - note.time, speed: body.speed,
                inLane: false, counterStrafed: false, headshot: false, reason: 'No shot' });
        });
        if (scorer.failed && !level.tutorial) {
            failed = true;
            break;
        }

        // Fire on the first tick at or after the beat, if we are in the lane.
        const target = beatMap.nextNote;
        const delay = reaction * (((target?.index ?? 0) * 7919) % 101) / 100;
        if (!idle && target && target.spawned && songTime >= target.time + delay) {
            const inLane = lanes.contains(target.lane, body.x);
            const zone = inLane ? aimZone : 'none';
            recorder.shot(songTime, inLane ? target.index : -1, zone, !inLane);
            const judgement = judge.judge(target, songTime, body.x, body.speed, body.isPlanted(clockMs),
                { hit: inLane, zone, blocked: !inLane });
            target.resolved = true;
            scorer.apply(judgement);
            if (scorer.failed && !level.tutorial) {
                failed = true;
            }
        }
    }
    const record = scorer.toRecord(level, !failed);
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
