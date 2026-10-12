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
        /** Song time (seconds) at the first tick, so a replay can rebuild the clock. */
        this.startSongTime = null;
        this.lastDirection = 0;
        this.clockMs = 0;
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
        };
    }
}
