/**
 * RunRecorder.js
 *
 * Records everything needed to replay a run exactly: the duration of every
 * simulation tick, every change of strafe input, and every shot with the
 * song time it was fired at and what the hit-scan found.
 *
 * The movement model is deterministic given the same tick lengths and
 * inputs, so a server that feeds this log back through the same code lands
 * on the same positions and speeds - and can recompute the score instead of
 * trusting the one the client sends.  The log is also a replay.
 *
 * Sizes are kept small: a 66-second run at 60 fps is ~4,000 tick values and
 * a few hundred events.
 */

import { LOG_VERSION } from './rules/config.js';

// Defined in rules/config.js so the replay validator (which the server runs)
// and the recorder can never disagree about it.
export { LOG_VERSION };

/** Log versions the replay viewer can still play back (3 = before tick-clock judging). */
export const REPLAYABLE_VERSIONS = Object.freeze([3, LOG_VERSION]);

/** Aim is sampled at most this often (~125 Hz), so a 66 s run adds well under 150 KB. */
const LOOK_INTERVAL_MS = 8;

/** Hit zones packed as small integers. */
export const ZONE_CODE = Object.freeze({ none: 0, body: 1, head: 2 });

export class RunRecorder {
    /**
     * @param {string} chartId
     * @param {{speed:number, accel:number}} [movement] the player's movement
     *   scale settings, so a replay or the server runs the same body.
     */
    constructor(chartId, movement = { speed: 1, accel: 1 }) {
        this.chartId = chartId;
        this.movement = { speed: movement.speed, accel: movement.accel };
        /** @type {number[]} tick lengths in milliseconds, rounded. */
        this.ticks = [];
        /** @type {Array<[number, number]>} [tickIndex, direction] */
        this.inputs = [];
        /** @type {Array<[number, number, number, number, number]>}
         *  [tickIndex, songTimeMs, noteIndex or -1, zoneCode, blocked 0/1] */
        this.shots = [];
        /**
         * Where the player was looking, for replays only (the validator
         * ignores it): flat triples [tickIndex, yaw, pitch], angles in
         * milliradians, written when the view moves.
         * @type {number[]}
         */
        this.look = [];
        this.lastLook = null;
        this.lastLookMs = Number.NEGATIVE_INFINITY;
        /** Song time (seconds) at the first tick, so a replay can rebuild the clock. */
        this.startSongTime = null;
        this.lastDirection = 0;
        this.clockMs = 0;
    }

    /**
     * Records the view direction against the tick just simulated, when it
     * moved by at least a milliradian and at most every LOOK_INTERVAL_MS
     * (a shot always records it, so the replay aims exactly where it fired).
     * @param {number} yaw radians
     * @param {number} pitch radians
     * @param {boolean} [force] record even inside the interval
     */
    aim(yaw, pitch, force = false) {
        const tick = this.tickIndex - 1;
        if (tick < 0) {
            return;
        }
        const y = Math.round(yaw * 1000);
        const p = Math.round(pitch * 1000);
        const last = this.lastLook;
        if (last && last[1] === y && last[2] === p) {
            return;
        }
        if (!force && this.clockMs - this.lastLookMs < LOOK_INTERVAL_MS) {
            return;
        }
        if (last && last[0] === tick) {
            // Same tick as the last sample: overwrite it rather than add one.
            this.look.length -= 3;
        }
        this.look.push(tick, y, p);
        this.lastLook = [tick, y, p];
        this.lastLookMs = this.clockMs;
    }

    /** @returns {number} the index the next tick will get. */
    get tickIndex() {
        return this.ticks.length;
    }

    /**
     * Call once per frame, before the body is updated.
     * @param {number} dtSeconds
     * @param {number} direction -1, 0 or 1
     * @param {number} songTime seconds
     * @returns {number} the simulation clock in milliseconds after this tick.
     */
    tick(dtSeconds, direction, songTime) {
        if (this.startSongTime === null) {
            this.startSongTime = songTime;
        }
        if (direction !== this.lastDirection) {
            this.inputs.push([this.tickIndex, direction]);
            this.lastDirection = direction;
        }
        const ms = Math.round(dtSeconds * 10000) / 10;
        this.ticks.push(ms);
        this.clockMs += ms;
        return this.clockMs;
    }

    /**
     * Records a shot against the tick that is currently being simulated.
     * @param {number} songTime
     * @param {number} noteIndex -1 when the shot reached no bot
     * @param {'none'|'body'|'head'} zone
     * @param {boolean} blocked
     */
    shot(songTime, noteIndex, zone, blocked) {
        this.shots.push([
            Math.max(0, this.tickIndex - 1),
            Math.round(songTime * 1000),
            noteIndex,
            ZONE_CODE[zone] ?? 0,
            blocked ? 1 : 0,
        ]);
    }

    /** @returns {object} the log, ready to send. */
    toJSON() {
        return {
            version: LOG_VERSION,
            chartId: this.chartId,
            movement: this.movement,
            startSongTime: this.startSongTime ?? 0,
            ticks: this.ticks,
            inputs: this.inputs,
            shots: this.shots,
            look: this.look,
        };
    }
}

/**
 * Reads a log's recorded view directions, or null when it has none (logs
 * from before aim was recorded) or they are malformed.
 * @param {object} log
 * @returns {{ticks: number[], yaw: number[], pitch: number[]} | null} radians
 */
export function readLook(log) {
    const flat = log?.look;
    if (!Array.isArray(flat) || flat.length < 3 || flat.length % 3 !== 0) {
        return null;
    }
    const ticks = [];
    const yaw = [];
    const pitch = [];
    let lastTick = -1;
    for (let i = 0; i < flat.length; i += 3) {
        const [tick, y, p] = [flat[i], flat[i + 1], flat[i + 2]];
        if (!Number.isInteger(tick) || tick < lastTick || !Number.isFinite(y) || !Number.isFinite(p)) {
            return null;
        }
        ticks.push(tick);
        yaw.push(y / 1000);
        pitch.push(p / 1000);
        lastTick = tick;
    }
    return { ticks, yaw, pitch };
}
