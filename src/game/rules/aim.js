/**
 * aim.js
 *
 * The aim model: how big the hit zone is and how wide the shot cone is, per
 * difficulty.  Easy and Normal get a larger hitbox and no spread; Hard and
 * Expert use the full model.  Both scales come from data/rules.json
 * (hitboxScale, spreadScale); nothing here hard-codes a difficulty.
 */
import { RULES } from './rules.js';
import { SPREAD } from './config.js';

/** Extra lane slack the server allows on top of the scaled zone. */
export const LANE_TOLERANCE = 1.15;

/**
 * @param {string} difficultyId
 * @returns {{hitboxScale: number, spreadScale: number}}
 */
export function aimScales(difficultyId) {
    // The tutorial has no rules row; it plays like Easy. Unknown ids get the
    // full model so a bad id can never make a run easier.
    const row = RULES.difficulties[difficultyId === 'tutorial' ? 'easy' : difficultyId]
        ?? RULES.difficulties.hard;
    return { hitboxScale: row.hitboxScale, spreadScale: row.spreadScale };
}

/** @param {object} level a chart definition */
export function aimScalesForLevel(level) {
    return aimScales(level?.difficulty?.id);
}

/**
 * Shot cone half-angle in degrees.
 * @param {number} speed current speed
 * @param {number} maxSpeed the level's top speed
 * @param {number} spreadScale 0 = laser, 1 = full model
 */
export function coneDegrees(speed, maxSpeed, spreadScale) {
    if (!(spreadScale > 0)) {
        return 0;
    }
    const fraction = Math.min(1, Math.max(0, speed / maxSpeed));
    return (SPREAD.baseDegrees + SPREAD.movingDegrees * Math.pow(fraction, SPREAD.exponent)) * spreadScale;
}

/**
 * The bot hit zones in the bot's billboard plane (world units).  Note the
 * pre-existing unit mix: bodyBottom is an absolute height from the feet,
 * bodyTop and headCentre are fractions of the sprite height, and
 * bodyHalfWidth / headRadius are absolute.
 */
export const HITBOX = Object.freeze({
    bodyHalfWidth: 0.46,
    bodyBottom: 0.04,
    bodyTop: 0.76,
    headCentre: 0.84,
    headRadius: 0.22,
});

/**
 * Grows the bot hit zones by `scale`.  The head grows about its (unchanged)
 * centre, the body widens about its centre line, and the body's lower edge
 * drops and its upper edge rises (capped at the full height).  Each field
 * keeps its own unit, see HITBOX.
 * @param {{bodyHalfWidth:number, bodyBottom:number, bodyTop:number, headCentre:number, headRadius:number}} hitbox
 * @param {number} scale
 */
export function scaleHitbox(hitbox, scale) {
    return {
        bodyHalfWidth: hitbox.bodyHalfWidth * scale,
        bodyBottom: hitbox.bodyBottom / scale,
        bodyTop: Math.min(1, hitbox.bodyTop * scale),
        headCentre: hitbox.headCentre,
        headRadius: hitbox.headRadius * scale,
    };
}

/**
 * Which zone a point on the bot's billboard plane hits.  The client's
 * TargetField calls this with the ray's impact point.
 * @param {number} dx sideways distance from the bot's centre
 * @param {number} fromBottom height above the bot's feet
 * @param {number} height the sprite height
 * @param {ReturnType<typeof scaleHitbox>} hitbox
 * @returns {'none'|'body'|'head'}
 */
export function zoneAt(dx, fromBottom, height, hitbox) {
    if (Math.hypot(dx, fromBottom - hitbox.headCentre * height) <= hitbox.headRadius) {
        return 'head';
    }
    if (Math.abs(dx) <= hitbox.bodyHalfWidth
        && fromBottom >= hitbox.bodyBottom
        && fromBottom <= hitbox.bodyTop * height) {
        return 'body';
    }
    return 'none';
}

/**
 * Server-side check of one claimed shot.  The client reports the zone it hit
 * (from its own ray test); the server only checks the replayed player was
 * plausibly aimed at that lane.  Two separate questions:
 *  - blocked: the lateral offset is past the lane half zone, widened by
 *    LANE_TOLERANCE.  There is deliberately no hitboxScale term: the server
 *    only validates Hard and Expert (daily/ranked), where hitboxScale is 1.
 *    The client scales the hitbox for Easy/Normal in TargetField picking.
 *  - hit: a claimed zone that is not blocked.
 * @param {{zone: string, offset: number, halfZone: number}} shot
 * @returns {{hit: boolean, zone: string, blocked: boolean}}
 */
export function resolveShot({ zone, offset, halfZone }) {
    const distance = Math.abs(offset);
    const blocked = distance > halfZone * LANE_TOLERANCE;
    const hit = zone !== 'none' && !blocked;
    return { hit, zone: hit ? zone : 'none', blocked };
}
