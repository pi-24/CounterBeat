/**
 * speedArc.js - pure helpers for the speed arc around the crosshair.
 * The arc fills with speed (against the level's top speed) and turns green
 * at or below the perfect-stop threshold.  Each band also has its own tick
 * position, so the arc never relies on colour alone.
 */
import { SPEED_GRADE } from '../rules/config.js';

export const ARC_COLOURS = Object.freeze({
    perfect: '#3dff9a', // green: at or below the perfect-stop threshold
    good: '#ffd23f',
    loose: '#ff9a3c',
    fast: '#ff3ca8',
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
