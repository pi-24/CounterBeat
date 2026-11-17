/**
 * speedArc.js - pure helpers for the speed arc around the crosshair.
 * The arc fills with speed (against the level's top speed) and turns acid
 * at or below the perfect-stop threshold.  Each band also has its own tick
 * position, so the arc never relies on colour alone.
 */
import { SPEED_GRADE } from '../rules/config.js';
import { GRADE_COLOURS } from '../../ui/palette.js';

/** perfect = acid (at or below the perfect-stop threshold), good = paper, loose = dim, fast = mute. */
export const ARC_COLOURS = Object.freeze({
    perfect: GRADE_COLOURS.default.perfect,
    good: GRADE_COLOURS.default.good,
    loose: GRADE_COLOURS.default.ok,
    fast: GRADE_COLOURS.default.miss,
});

/** One threshold source: `grades` ({pinPoint, tight, loose}, i.e. SPEED_GRADE) feeds colour and ticks.
 * @param {number} speed units/s (absolute) @returns {'perfect'|'good'|'loose'|'fast'} */
export function arcBand(speed, grades = SPEED_GRADE) {
    const s = Math.abs(speed);
    if (s <= grades.pinPoint) return 'perfect';
    if (s <= grades.tight) return 'good';
    if (s <= grades.loose) return 'loose';
    return 'fast';
}

/** @returns {string} hex colour for the live speed. */
export function arcColour(speed, grades = SPEED_GRADE) {
    return ARC_COLOURS[arcBand(speed, grades)];
}

/** Fraction 0..1 of the arc to fill for a speed. */
export function arcFill(speed, maxSpeed) {
    if (!(maxSpeed > 0)) return 0;
    return Math.max(0, Math.min(1, Math.abs(speed) / maxSpeed));
}

/** Tick positions (speeds) for the arc; always equal to the band boundaries used by arcBand. */
export function arcTickSpeeds(grades = SPEED_GRADE) {
    return { perfect: grades.pinPoint, good: grades.tight, loose: grades.loose };
}
