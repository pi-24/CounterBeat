/**
 * simulate.mjs
 *
 * A headless check of the game rules, run with `node tests/simulate.mjs`.
 *
 * It drives the real BeatMap, CounterStrafeBody, Judge and Scorer classes with
 * two scripted players:
 *
 *   counter-strafe  taps the opposite key to stop, the technique the game is
 *                   built around;
 *   release only    just lets go of the movement key and slides to a halt.
 *
 * The first should clear every level cleanly, which proves the generated
 * charts are physically playable.  The second should fall apart as the tempo
 * climbs, which is the evidence that counter-strafing is the actual skill
 * being tested rather than decoration.
 *
 * This is a development tool, not part of the website.
 */
import { LEVELS } from '../../website/js/game/levels.js';
import { BeatMap } from '../../website/js/game/BeatMap.js';
import { CounterStrafeBody } from '../../website/js/game/CounterStrafeBody.js';
import { Judge } from '../../website/js/game/Judge.js';
import { Scorer } from '../../website/js/game/Scorer.js';
import { SPEED_GRADE } from '../../website/js/game/config.js';

const FPS = 60;
const STEP = 1 / FPS;

/**
 * Accelerate towards the target until the remaining distance is no more than
 * the counter-strafe braking distance, then press the opposite key.  This is
 * the technique the game teaches, written as three lines of control logic.
 */
function counterStrafePilot(body, targetX) {
    const gap = targetX - body.x;
    const v = body.velocity;
    const braking = (v * v) / (2 * body.movement.counterDecel);

    if (Math.abs(gap) < 6 && Math.abs(v) < SPEED_GRADE.pinPoint) {
        return 0;
    }
    if (v !== 0 && Math.sign(v) === Math.sign(gap) && braking >= Math.abs(gap)) {
        return -Math.sign(v);
    }
    return Math.sign(gap);
}

/**
 * The same plan, except this pilot never presses the opposing key: it releases
 * and lets friction do the work, which is what most players do before they
 * learn to counter-strafe.
 */
function releaseOnlyPilot(body, targetX) {
    const gap = targetX - body.x;
    const v = body.velocity;
    const coasting = (v * v) / (2 * body.movement.friction);

    if (Math.abs(gap) < 6 && Math.abs(v) < SPEED_GRADE.pinPoint) {
        return 0;
    }
    if (v !== 0 && Math.sign(v) === Math.sign(gap) && coasting >= Math.abs(gap)) {
        return 0;
    }
    if (v !== 0 && Math.sign(v) !== Math.sign(gap)) {
        return 0;
    }
    return Math.sign(gap);
}

/**
 * @param {object} level
 * @param {(body: CounterStrafeBody, targetX: number) => number} pilot
 */
function playLevel(level, pilot) {
    const beatMap = new BeatMap(level);
    const judge = new Judge(level, beatMap.lanes);
    const scorer = new Scorer(beatMap.total);
    const body = new CounterStrafeBody(
        level.movement,
        { min: beatMap.lanes.left + 16, max: beatMap.lanes.right - 16 },
        beatMap.lanes.centre(Math.floor(level.lanes / 2)),
    );

    let noteIndex = 0;
    let songTime = 0;
    let laneChanges = 0;
    let previousLane = null;

    while (noteIndex < beatMap.notes.length && songTime < beatMap.duration + 5) {
        const note = beatMap.notes[noteIndex];
        const targetX = beatMap.lanes.centre(note.lane);

        body.setInput(pilot(body, targetX));
        body.update(STEP, songTime * 1000);
        songTime += STEP;

        if (songTime >= note.time) {
            scorer.apply(judge.judge(
                note, songTime, body.x, body.speed, body.isPlanted(songTime * 1000),
            ));
            if (previousLane !== null && previousLane !== note.lane) {
                laneChanges += 1;
            }
            previousLane = note.lane;
            noteIndex += 1;
        }
    }

    const gaps = beatMap.notes.slice(1).map((note, i) => note.time - beatMap.notes[i].time);

    return {
        notes: beatMap.total,
        laneChanges: `${Math.round((laneChanges / beatMap.total) * 100)}%`,
        minGap: `${Math.round(Math.min(...gaps) * 1000)}ms`,
        perfect: scorer.tally.perfect,
        good: scorer.tally.good,
        loose: scorer.tally.ok,
        missed: scorer.tally.miss,
        accuracy: `${(scorer.accuracy * 100).toFixed(1)}%`,
        counterStrafes: scorer.counterStrafes,
        score: scorer.score,
        rank: scorer.rank,
    };
}

const report = {};
for (const level of LEVELS) {
    report[`L${level.id} ${level.name} — counter-strafe`] = playLevel(level, counterStrafePilot);
    report[`L${level.id} ${level.name} — release only`] = playLevel(level, releaseOnlyPilot);
}
console.table(report);
