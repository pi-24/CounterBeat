/**
 * CounterStrafeBody.js
 *
 * The movement model that the whole game is built on.  It is deliberately a
 * plain class with no Phaser in it, because the chart generator needs to ask
 * it "could a player physically cross this distance in this much time?" long
 * before any sprite exists.
 *
 * The three behaviours it models:
 *
 *   - Holding a direction accelerates towards `maxSpeed`.
 *   - Releasing everything applies `friction`, which is slow: you slide.
 *   - Pressing the *opposite* direction while still moving applies
 *     `counterDecel`, which is far stronger, and the body is pinned to
 *     exactly zero on the frame it would cross through zero.  That is the
 *     counter-strafe.
 *
 * Holding the opposing key past the stop does not keep decelerating - the
 * body starts accelerating the other way at the normal rate, which is what
 * punishes a tap that was held too long.
 */
import { COUNTER_STRAFE_MEMORY_MS } from './config.js';

const STOP_SPEED = 18;

export class CounterStrafeBody {
    /**
     * @param {{maxSpeed:number, accel:number, counterDecel:number, friction:number}} movement
     * @param {{min:number, max:number}} bounds horizontal limits in pixels.
     * @param {number} startX
     */
    constructor(movement, bounds, startX) {
        this.movement = movement;
        this.bounds = bounds;
        this.x = startX;
        this.velocity = 0;
        this.inputDirection = 0;

        /** True on any frame where the counter-strafe deceleration is active. */
        this.counterStrafing = false;
        /** Timestamp (ms) of the last frame a counter-strafe was active. */
        this.lastCounterStrafeAt = Number.NEGATIVE_INFINITY;
        /** Timestamp (ms) at which a counter-strafe last produced a dead stop. */
        this.lastPlantedAt = Number.NEGATIVE_INFINITY;
    }

    /** @param {number} direction -1 for left, 1 for right, 0 for no input. */
    setInput(direction) {
        this.inputDirection = Math.sign(direction);
    }

    /** @returns {number} absolute speed in pixels per second. */
    get speed() {
        return Math.abs(this.velocity);
    }

    /**
     * Whether the player's current stop can be credited to a counter-strafe.
     * @param {number} nowMs
     * @returns {boolean}
     */
    isPlanted(nowMs) {
        return nowMs - this.lastPlantedAt <= COUNTER_STRAFE_MEMORY_MS
            || nowMs - this.lastCounterStrafeAt <= COUNTER_STRAFE_MEMORY_MS;
    }

    /**
     * Advances the simulation.
     * @param {number} deltaSeconds
     * @param {number} nowMs a monotonic clock, used only for the bonus window.
     */
    update(deltaSeconds, nowMs) {
        const { maxSpeed, accel, counterDecel, friction } = this.movement;
        const dt = Math.min(deltaSeconds, 0.05); // guard against tab stalls
        const dir = this.inputDirection;
        const v = this.velocity;

        let acceleration = 0;
        let counteringNow = false;

        if (dir !== 0) {
            if (v !== 0 && Math.sign(v) === -dir) {
                acceleration = dir * counterDecel;
                counteringNow = true;
            } else {
                acceleration = dir * accel;
            }
        } else if (v !== 0) {
            acceleration = -Math.sign(v) * friction;
        }

        let next = v + acceleration * dt;

        if (counteringNow && Math.sign(next) !== Math.sign(v)) {
            // The counter-strafe cancelled the momentum exactly.
            next = 0;
            this.lastPlantedAt = nowMs;
        } else if (dir === 0) {
            if (Math.sign(next) !== Math.sign(v) || Math.abs(next) < STOP_SPEED) {
                next = 0;
            }
        }

        this.velocity = Math.max(-maxSpeed, Math.min(maxSpeed, next));
        this.counterStrafing = counteringNow;
        if (counteringNow) {
            this.lastCounterStrafeAt = nowMs;
        }

        this.x += this.velocity * dt;
        if (this.x <= this.bounds.min) {
            this.x = this.bounds.min;
            this.velocity = 0;
        } else if (this.x >= this.bounds.max) {
            this.x = this.bounds.max;
            this.velocity = 0;
        }
    }

    /** Puts the body back at a standstill. */
    reset(x) {
        this.x = x;
        this.velocity = 0;
        this.inputDirection = 0;
        this.counterStrafing = false;
        this.lastCounterStrafeAt = Number.NEGATIVE_INFINITY;
        this.lastPlantedAt = Number.NEGATIVE_INFINITY;
    }

    /**
     * The furthest a player could travel in `seconds` while starting and
     * finishing at a dead stop.  The chart generator uses this so it never
     * writes a lane change that is physically impossible to hit.
     *
     * @param {{maxSpeed:number, accel:number, counterDecel:number}} movement
     * @param {number} seconds
     * @returns {number} distance in pixels.
     */
    static maxDistance(movement, seconds) {
        const { maxSpeed, accel, counterDecel } = movement;
        if (seconds <= 0) {
            return 0;
        }
        const timeToTop = maxSpeed / accel;
        const timeToStop = maxSpeed / counterDecel;

        if (seconds >= timeToTop + timeToStop) {
            const rampDistance = (maxSpeed * maxSpeed) / (2 * accel)
                + (maxSpeed * maxSpeed) / (2 * counterDecel);
            return rampDistance + maxSpeed * (seconds - timeToTop - timeToStop);
        }

        // Triangular profile: never reaches top speed.
        const peak = seconds / (1 / accel + 1 / counterDecel);
        return (peak * peak) / (2 * accel) + (peak * peak) / (2 * counterDecel);
    }
}
