/**
 * validateRun.js
 *
 * Replays a recorded run through the real rules and recomputes its score.
 *
 * This is what makes the leaderboard worth anything: the client never gets to
 * say what it scored.  It sends the tick lengths, the strafe inputs and the
 * shots (see RunRecorder.js); this function feeds them through the same
 * CounterStrafeBody, BeatMap, Judge and Scorer the game used, so the
 * positions and speeds come out identical, and the score is whatever those
 * rules produce.
 *
 * It runs in the Supabase edge function and in Node tests.  It must stay
 * free of browser and engine dependencies - the only thing it cannot verify
 * is where the crosshair was, so a hit's zone (head/body) is taken from the
 * client but only honoured when the replayed position had line of sight.
 */
import { APPROACH_BEATS, GRADE } from './config.js';
import { BeatMap } from './BeatMap.js';
import { CounterStrafeBody } from './CounterStrafeBody.js';
import { Judge } from './Judge.js';
import { Scorer } from './Scorer.js';
import { MOVEMENT_SCALE } from './config.js';

const LIMITS = Object.freeze({
    maxTicks: 30000,
    maxShots: 3000,
    minTickMs: 0.5,
    maxTickMs: 120,
    clockToleranceSeconds: 0.2,
    maxShotsPerSecond: 15,
    /** With this many hits, a timing spread this tight is not a human. */
    inhumanSampleSize: 25,
    inhumanErrorSeconds: 0.006,
    inhumanFraction: 0.95,
    /** Server-side lane check is a little looser than the client zone. */
    laneTolerance: 1.15,
});

const ZONES = ['none', 'body', 'head'];

/**
 * @param {object} level a chart definition from charts.js
 * @param {object} log a RunRecorder log
 * @param {number} [claimedScore] what the client reported, for the mismatch flag
 * @returns {{ok: true, record: object, mismatch: boolean} | {ok: false, reason: string}}
 */
export function validateRun(level, log, claimedScore) {
    const fail = (reason) => ({ ok: false, reason });

    // ---- structure --------------------------------------------------------
    if (!log || log.version !== 3) {
        return fail('unsupported log version');
    }
    if (log.chartId !== level.chartId) {
        return fail('chart mismatch');
    }
    const { ticks, inputs, shots } = log;
    if (!Array.isArray(ticks) || !Array.isArray(inputs) || !Array.isArray(shots)) {
        return fail('malformed log');
    }
    const scale = { speed: 1, accel: 1, ...(log.movement ?? {}) };
    for (const key of ['speed', 'accel']) {
        if (!Number.isFinite(scale[key]) || scale[key] < MOVEMENT_SCALE.min || scale[key] > MOVEMENT_SCALE.max) {
            return fail('movement settings out of range');
        }
    }
    if (ticks.length === 0 || ticks.length > LIMITS.maxTicks || shots.length > LIMITS.maxShots) {
        return fail('log size out of range');
    }
    for (const ms of ticks) {
        if (typeof ms !== 'number' || ms < LIMITS.minTickMs || ms > LIMITS.maxTickMs) {
            return fail('tick length out of range');
        }
    }
    let lastTick = -1;
    for (const [tick, dir] of inputs) {
        if (!Number.isInteger(tick) || tick < lastTick || tick >= ticks.length || ![-1, 0, 1].includes(dir)) {
            return fail('malformed input event');
        }
        lastTick = tick;
    }
    lastTick = -1;
    for (const shot of shots) {
        const [tick, songMs, noteIndex, zone, blocked] = shot;
        if (!Number.isInteger(tick) || tick < lastTick || tick >= ticks.length
            || !Number.isFinite(songMs) || !Number.isInteger(noteIndex) || noteIndex < -1
            || ![0, 1, 2].includes(zone) || ![0, 1].includes(blocked)) {
            return fail('malformed shot event');
        }
        lastTick = tick;
    }

    // ---- replay -----------------------------------------------------------
    const beatMap = new BeatMap(level);
    const lanes = beatMap.lanes;
    const judge = new Judge(level, lanes);
    const scorer = new Scorer(beatMap.total);
    const body = new CounterStrafeBody(
        CounterStrafeBody.scaled(level.movement, scale),
        { min: lanes.left + 16, max: lanes.right - 16 },
        lanes.centre(Math.floor(level.lanes / 2)),
    );
    const lead = APPROACH_BEATS * (60 / level.bpm);
    const notes = beatMap.notes;
    for (const note of notes) {
        if (noteIndexInvalid(note, notes)) {
            return fail('chart index mismatch');
        }
    }

    let clockMs = 0;
    let inputCursor = 0;
    let shotCursor = 0;
    let failedAtTick = -1;
    const timingErrors = [];
    const shotTimes = [];

    const spawnedAt = (songTime) => {
        for (const note of notes) {
            if (!note.spawned && !note.resolved && note.time - songTime <= lead) {
                note.spawned = true;
            }
        }
    };

    for (let i = 0; i < ticks.length; i += 1) {
        while (inputCursor < inputs.length && inputs[inputCursor][0] === i) {
            body.setInput(inputs[inputCursor][1]);
            inputCursor += 1;
        }
        const dt = ticks[i] / 1000;
        clockMs += ticks[i];
        body.update(dt, clockMs);
        const songTime = log.startSongTime + clockMs / 1000;
        spawnedAt(songTime);

        while (shotCursor < shots.length && shots[shotCursor][0] === i) {
            const [, songMs, noteIndex, zoneCode, blockedFlag] = shots[shotCursor];
            shotCursor += 1;
            if (failedAtTick >= 0) {
                continue; // the run was already over on the client
            }
            const shotTime = songMs / 1000;
            if (Math.abs(shotTime - songTime) > LIMITS.clockToleranceSeconds) {
                return fail('shot time disagrees with the tick clock');
            }
            shotTimes.push(shotTime);
            const outcome = replayShot({
                level, beatMap, lanes, judge, scorer, body, notes,
                shotTime, noteIndex, zone: ZONES[zoneCode], blocked: blockedFlag === 1, clockMs,
            });
            if (!outcome.ok) {
                return fail(outcome.reason);
            }
            if (outcome.timingError !== undefined) {
                timingErrors.push(outcome.timingError);
            }
        }

        // Notes that ran past their window without a shot.
        for (const note of notes) {
            if (note.spawned && !note.resolved && songTime > note.time + level.timing.ok) {
                note.resolved = true;
                scorer.apply({
                    grade: GRADE.MISS, timingError: songTime - note.time, speed: body.speed,
                    inLane: false, counterStrafed: false, headshot: false, reason: 'No shot',
                });
            }
        }

        if (scorer.failed && !level.tutorial && failedAtTick < 0) {
            failedAtTick = i;
        }
    }

    // ---- plausibility -----------------------------------------------------
    for (let i = 0; i + LIMITS.maxShotsPerSecond < shotTimes.length; i += 1) {
        if (shotTimes[i + LIMITS.maxShotsPerSecond] - shotTimes[i] < 1) {
            return fail('fire rate is not plausible');
        }
    }
    if (timingErrors.length >= LIMITS.inhumanSampleSize) {
        const tight = timingErrors.filter((e) => Math.abs(e) <= LIMITS.inhumanErrorSeconds).length;
        if (tight / timingErrors.length >= LIMITS.inhumanFraction) {
            return fail('timing is not plausible');
        }
    }

    const endSongTime = log.startSongTime + clockMs / 1000;
    const allResolved = notes.every((note) => note.resolved);
    const completed = failedAtTick < 0 && (allResolved || endSongTime >= beatMap.duration);

    const record = scorer.toRecord(level, completed);
    record.rank = scorer.rank;
    record.passed = completed && scorer.accuracy >= level.passAccuracy;
    record.verified = true;

    const mismatch = typeof claimedScore === 'number'
        && Math.abs(claimedScore - record.score) > Math.max(50, record.score * 0.05);

    return { ok: true, record, mismatch };
}

/**
 * One shot, mirroring PlayScreen.fire() exactly.
 * @returns {{ok: boolean, reason?: string, timingError?: number}}
 */
function replayShot({ level, beatMap, lanes, judge, scorer, body, notes, shotTime, noteIndex, zone, blocked, clockMs }) {
    let note = noteIndex >= 0 ? notes[noteIndex] : null;
    if (noteIndex >= 0 && (!note || note.resolved || !note.spawned)) {
        return { ok: false, reason: 'shot references a bot that was not there' };
    }

    // Too early: a flinch, a combo break, and the note stays.
    if (note && shotTime < note.time - level.timing.ok) {
        scorer.registerWildShot();
        return { ok: true };
    }

    if (!note) {
        note = beatMap.findNoteNear(shotTime, level.timing.ok);
        if (!note) {
            const live = notes.some((candidate) => candidate.spawned && !candidate.resolved);
            if (live) {
                scorer.registerWildShot();
            }
            return { ok: true };
        }
        const judgement = judge.judge(note, shotTime, body.x, body.speed, body.isPlanted(clockMs),
            { hit: false, zone: 'none', blocked });
        note.resolved = true;
        scorer.apply(judgement);
        return { ok: true };
    }

    // A claimed hit only stands if the replayed position had line of sight.
    const inLane = Math.abs(body.x - lanes.centre(note.lane)) <= lanes.halfZone * LIMITS.laneTolerance;
    const hit = zone !== 'none' && inLane;
    const judgement = judge.judge(note, shotTime, body.x, body.speed, body.isPlanted(clockMs),
        { hit, zone: hit ? zone : 'none', blocked: !inLane });
    note.resolved = true;
    scorer.apply(judgement);
    return { ok: true, timingError: judgement.grade === GRADE.MISS ? undefined : judgement.timingError };
}

/** Charts are generated from a seed; the index must match its position. */
function noteIndexInvalid(note, notes) {
    return notes[note.index] !== note;
}
