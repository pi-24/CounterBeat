/**
 * scripted-player.mjs
 *
 * A scripted player that plays a level through the client-side rules classes
 * while a RunRecorder logs it.  Shared by tools/test-validate.mjs and the unit
 * tests, so a recorded replay can be fed to validateRun.
 */
import { BeatMap } from '../../src/game/rules/BeatMap.js';
import { CounterStrafeBody } from '../../src/game/rules/CounterStrafeBody.js';
import { Judge } from '../../src/game/rules/Judge.js';
import { Scorer } from '../../src/game/rules/Scorer.js';
import { SPEED_GRADE, GRADE, APPROACH_BEATS } from '../../src/game/rules/config.js';
import { RunRecorder } from '../../src/game/RunRecorder.js';

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
export function playAndRecord(level, options = {}) {
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

