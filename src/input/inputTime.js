/**
 * inputTime.js - when an input really happened, so a shot handled a frame
 * late is still timed at the instant it was made.  Mouse events carry their
 * own `timeStamp`; a polled gamepad carries `pad.timestamp`, the time its
 * snapshot was produced.  Both land in the same place: `PlayScreen.fire`
 * winds the shot back by `inputLagSeconds`, so pad and mouse shots made at the
 * same real instant get the same timing error.  Pure, no DOM.
 */

/** A stamp older than this is not trusted (a stalled tab, a bogus clock). */
export const MAX_INPUT_LAG = 0.1;

/**
 * How long ago (seconds) an input happened, or 0 when the stamp is missing,
 * in the future or too old to trust.
 * @param {number} nowMs performance.now()
 * @param {number|undefined} stampMs the event's timeStamp
 * @param {number} [maxLag] seconds
 */
export function inputLagSeconds(nowMs, stampMs, maxLag = MAX_INPUT_LAG) {
    if (!Number.isFinite(stampMs)) return 0;
    const lag = (nowMs - stampMs) / 1000;
    return lag > 0 && lag < maxLag ? lag : 0;
}

/**
 * The time to give a pad press: the snapshot's own timestamp (never later
 * than now), less the player's pad latency compensation.  Falls back to `now`
 * when the browser gives no usable timestamp.
 * @param {{timestamp?:number}} pad
 * @param {number} nowMs performance.now()
 * @param {number} [latencyMs] extra pad input latency to wind back, from Settings
 * @returns {number}
 */
export function padEventStamp(pad, nowMs, latencyMs = 0) {
    const raw = pad?.timestamp;
    const stamp = Number.isFinite(raw) && raw <= nowMs ? raw : nowMs;
    const extra = Number.isFinite(latencyMs) ? latencyMs : 0;
    return stamp - extra;
}
