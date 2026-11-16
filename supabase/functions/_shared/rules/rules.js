/**
 * rules.js
 *
 * The single shared rules module: stop grading, shot grading and the
 * per-difficulty rule table.  The client, the headless simulator and the
 * Supabase edge function all import this file (the edge function through the
 * copy `npm run sync-rules` makes), so a shot is graded identically
 * everywhere.  The numbers live in data/rules.json; sync-rules mirrors them
 * into rulesData.js so this module needs no JSON import support.
 */
import RULES_DATA from './rulesData.js';

export const RULES = RULES_DATA;

/** Grade names, worst to best. */
export const GRADES = Object.freeze(['miss', 'ok', 'good', 'perfect']);

/** Stop speed thresholds in track units per second (20 / 65 / 140). */
export const STOP_SPEED = Object.freeze({ ...RULES.grading.stopSpeed });

/** Accuracy at which a run is rank A (the letter-rank threshold). */
export const RANK_A_ACCURACY = RULES.grading.rankAccuracy;
/** Counter-strafe credit window in milliseconds (320). */
export const COUNTER_STRAFE_WINDOW_MS = RULES.grading.counterStrafeWindowMs;

/** @param {string} id @returns {object|undefined} the rule row for a difficulty. */
export function getRules(id) {
    return RULES.difficulties[id];
}

/**
 * The stop grade is the same on every difficulty by design.
 * @param {number} speed absolute speed in track units per second
 * @returns {'perfect'|'good'|'ok'|'miss'}
 */
export function gradeStop(speed) {
    if (speed <= STOP_SPEED.perfect) {
        return 'perfect';
    }
    if (speed <= STOP_SPEED.good) {
        return 'good';
    }
    if (speed <= STOP_SPEED.loose) {
        return 'ok';
    }
    return 'miss';
}

/**
 * @param {number} error timing error in seconds (sign ignored)
 * @param {{perfect:number, good:number, ok:number}} windows
 */
export function gradeTiming(error, windows) {
    const absolute = Math.abs(error);
    if (absolute <= windows.perfect) {
        return 'perfect';
    }
    if (absolute <= windows.good) {
        return 'good';
    }
    if (absolute <= windows.ok) {
        return 'ok';
    }
    return 'miss';
}

/** @param {...string} grades @returns {string} the worst grade given. */
export function worstGrade(...grades) {
    return grades.reduce((lowest, grade) => (
        GRADES.indexOf(grade) < GRADES.indexOf(lowest) ? grade : lowest
    ), 'perfect');
}

/** Shot grade = the worse of the timing grade and the stop grade. */
export function gradeShot(timingError, speed, windows) {
    return worstGrade(gradeTiming(timingError, windows), gradeStop(speed));
}

/**
 * Chart density in notes per second over the bars the chart actually uses.
 * @param {{notes:{length:number}, bpm:number, bars:number, firstNoteBar:number}} chart
 */
export function chartDensity(notesCount, bpm, bars, firstNoteBar) {
    const seconds = (bars - firstNoteBar) * 4 * (60 / bpm);
    return notesCount / seconds;
}
