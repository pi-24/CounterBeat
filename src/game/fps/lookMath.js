/**
 * lookMath.js - the view-angle arithmetic shared by the mouse and the pad's
 * right stick.  Pure (no engine import) so it is unit-tested in node.
 */
export const PITCH_LIMIT = (80 * Math.PI) / 180;

/**
 * Adds a turn to a view, clamping pitch.  A pad turns the view with no pointer
 * lock at all, so the only gate is whether look is enabled (in play, not
 * paused, not a replay).
 * @param {{yaw:number, pitch:number}} view
 * @param {number} dYaw radians @param {number} dPitch radians
 * @param {boolean} enabled
 * @returns {{yaw:number, pitch:number}} a new view
 */
export function applyLookDelta(view, dYaw, dPitch, enabled) {
    if (!enabled) return { yaw: view.yaw, pitch: view.pitch };
    return { yaw: view.yaw + dYaw, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, view.pitch + dPitch)) };
}
