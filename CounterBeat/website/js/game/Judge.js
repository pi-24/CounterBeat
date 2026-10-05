/**
 * Judge.js
 *
 * Decides what a shot was worth.  A shot has to satisfy independent
 * conditions, and the final grade is the worst of them - being perfectly on
 * the beat does not rescue a shot fired at a sprint.
 */
import { GRADE, SPEED_GRADE } from './config.js';

/** Ordered worst-to-best so two grades can be compared numerically. */
const ORDER = [GRADE.MISS, GRADE.OK, GRADE.GOOD, GRADE.PERFECT];

/**
 * What the hit-scan found.  `zone` is where on the bot the shot landed.
 * @typedef {object} AimResult
 * @property {boolean} hit      the shot ray reached the bot
 * @property {'head'|'body'|'none'} zone
 * @property {boolean} blocked  the ray hit the wall first - wrong window
 */

/**
 * @typedef {object} Judgement
 * @property {string} grade
 * @property {number} timingError seconds; negative means early.
 * @property {number} speed track units per second at the moment of the shot.
 * @property {boolean} inLane
 * @property {boolean} counterStrafed
 * @property {boolean} headshot
 * @property {string} reason a short explanation shown on screen.
 */

export class Judge {
    /**
     * @param {object} level the level definition (for its timing windows).
     * @param {import('./BeatMap.js').Lanes} lanes
     */
    constructor(level, lanes) {
        this.timing = level.timing;
        this.lanes = lanes;
    }

    /** @param {number} error absolute timing error in seconds. */
    gradeTiming(error) {
        const absolute = Math.abs(error);
        if (absolute <= this.timing.perfect) {
            return GRADE.PERFECT;
        }
        if (absolute <= this.timing.good) {
            return GRADE.GOOD;
        }
        if (absolute <= this.timing.ok) {
            return GRADE.OK;
        }
        return GRADE.MISS;
    }

    /** @param {number} speed absolute speed in track units per second. */
    gradeSpeed(speed) {
        if (speed <= SPEED_GRADE.pinPoint) {
            return GRADE.PERFECT;
        }
        if (speed <= SPEED_GRADE.tight) {
            return GRADE.GOOD;
        }
        if (speed <= SPEED_GRADE.loose) {
            return GRADE.OK;
        }
        return GRADE.MISS;
    }

    /**
     * @param {import('./BeatMap.js').Note} note
     * @param {number} songTime seconds
     * @param {number} playerX track units
     * @param {number} speed
     * @param {boolean} counterStrafed
     * @param {AimResult} [aim] omitted by the headless simulator, which
     *   treats "standing in the lane" as a guaranteed body hit.
     * @returns {Judgement}
     */
    judge(note, songTime, playerX, speed, counterStrafed, aim) {
        const timingError = songTime - note.time;
        const inLane = this.lanes.contains(note.lane, playerX);
        const result = aim ?? { hit: inLane, zone: inLane ? 'body' : 'none', blocked: !inLane };

        const timingGrade = this.gradeTiming(timingError);
        const speedGrade = this.gradeSpeed(speed);

        let grade = Judge.worst(timingGrade, speedGrade);
        let reason = '';

        if (!result.hit) {
            grade = GRADE.MISS;
            reason = result.blocked ? 'Blocked — wrong window' : 'Missed the bot';
        } else if (grade === GRADE.MISS) {
            reason = speedGrade === GRADE.MISS ? 'Firing on the move' : 'Off the beat';
        } else if (speedGrade !== GRADE.PERFECT && timingGrade === GRADE.PERFECT) {
            reason = 'Still sliding';
        } else if (timingGrade !== GRADE.PERFECT && speedGrade === GRADE.PERFECT) {
            reason = timingError < 0 ? 'Early' : 'Late';
        }

        const headshot = grade !== GRADE.MISS && result.zone === 'head';
        if (headshot && !reason) {
            reason = 'Headshot';
        }

        return {
            grade,
            timingError,
            speed,
            inLane,
            counterStrafed: counterStrafed && grade !== GRADE.MISS,
            headshot,
            reason,
        };
    }

    /** @param {...string} grades @returns {string} the lowest grade given. */
    static worst(...grades) {
        return grades.reduce((lowest, grade) => (
            ORDER.indexOf(grade) < ORDER.indexOf(lowest) ? grade : lowest
        ), GRADE.PERFECT);
    }
}
