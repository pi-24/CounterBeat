/**
 * CounterStrafeBody.js
 *
 * The movement model that the whole game is built on.  It is deliberately a
 * plain class with nothing engine-specific in it, because the chart
 * generator needs to ask it "could a player physically cross this distance
 * in this much time?" long before any sprite exists, and the server replays
 * it to verify runs.
 *
 * It is the Source-engine ground model that CS and Valorant players have in
 * their hands, in one dimension:
 *
 *   - Ground friction runs every tick and is proportional to speed, with a
 *     floor (`stopSpeed`) so a slow body is braked at a fixed rate instead
 *     of creeping forever.  Release at full speed and you decelerate hard at
 *     first, then settle - the slide, not an ice rink.
 *   - Holding a key adds speed towards `maxSpeed` by a fixed amount per
 *     second (`accel` × maxSpeed), so a tap is a small nudge that friction
 *     eats in a few frames, while a hold reaches full speed in roughly
 *     1/accel seconds.
 *   - Pressing the *opposite* key while moving is the same acceleration
 *     pointed backwards, on top of friction: that is the counter-strafe, and
 *     it stops the body several times faster than releasing does.  On the
 *     tick it would cross through zero it is pinned to exactly zero.
 *
 * Holding the opposing key past the stop does not keep braking - the body
 * starts accelerating the other way at the normal rate, which is what
 * punishes a tap that was held too long.
 *
 * @typedef {object} Movement
 * @property {number} maxSpeed  pixels per second
 * @property {number} accel     per second: speed gained per second is accel × maxSpeed
 * @property {number} friction  per second: proportional braking rate
 * @property {number} stopSpeed pixels per second: below this, braking is linear
 */
import { COUNTER_STRAFE_MEMORY_MS } from './config.js';

/** Step used for the analytic helpers (reach, braking distance). */
const PLAN_STEP = 1 / 120;
/** Longest tick the model will integrate at once: a stall is split, not jumped. */
const MAX_DT = 0.05;

export class CounterStrafeBody {
    /**
     * @param {Movement} movement
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

    /**
     * A chart's movement with the player's speed and acceleration settings
     * applied.  Speed scales the top speed and the friction floor together,
     * so the slide keeps its shape; acceleration scales how fast speed is
     * gained (and lost on a counter-strafe).
     * @param {Movement} movement
     * @param {{speed?:number, accel?:number}} [scale]
     * @returns {Movement}
     */
    static scaled(movement, scale = {}) {
        const speed = Number.isFinite(scale.speed) ? scale.speed : 1;
        const accel = Number.isFinite(scale.accel) ? scale.accel : 1;
        return {
            maxSpeed: movement.maxSpeed * speed,
            accel: movement.accel * accel,
            friction: movement.friction,
            stopSpeed: movement.stopSpeed * speed,
        };
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
        const dt = Math.min(deltaSeconds, MAX_DT);
        const dir = this.inputDirection;
        const before = this.velocity;

        const countering = dir !== 0 && before !== 0 && Math.sign(before) === -dir;
        let next = CounterStrafeBody.step(this.movement, before, dir, dt);

        if (countering && (next === 0 || Math.sign(next) !== Math.sign(before))) {
            // The counter-strafe cancelled the momentum exactly.
            next = 0;
            this.lastPlantedAt = nowMs;
        }

        this.velocity = next;
        this.counterStrafing = countering;
        if (countering) {
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
     * One tick of the ground model: friction, then acceleration towards the
     * wished direction.  Pure, so the planners below can run it ahead.
     * @param {Movement} movement
     * @param {number} velocity
     * @param {number} dir -1, 0 or 1
     * @param {number} dt
     * @returns {number} the new velocity
     */
    static step(movement, velocity, dir, dt) {
        const { maxSpeed, accel, friction, stopSpeed } = movement;
        let v = velocity;

        // Friction: proportional to speed, with a floor so the last stretch is
        // braked at a fixed rate and the body actually reaches zero.
        const speed = Math.abs(v);
        if (speed > 0) {
            const control = Math.max(speed, stopSpeed);
            const drop = control * friction * dt;
            const remaining = Math.max(0, speed - drop);
            v = speed > 0 ? v * (remaining / speed) : 0;
        }

        // Accelerate: add up to accel × maxSpeed per second towards the wish,
        // never past it.
        if (dir !== 0) {
            const current = v * dir;
            const wanted = maxSpeed - current;
            if (wanted > 0) {
                v += dir * Math.min(wanted, accel * maxSpeed * dt);
            }
        }
        if (Math.abs(v) < 1e-6) {
            v = 0;
        }
        return v;
    }

    /**
     * Distance covered while counter-strafing from `velocity` to a stop.
     * @param {Movement} movement
     * @param {number} velocity
     * @returns {number} pixels (positive)
     */
    static brakingDistance(movement, velocity) {
        return CounterStrafeBody.stopProfile(movement, velocity, -Math.sign(velocity)).distance;
    }

    /**
     * Distance covered while sliding to a stop with nothing pressed.
     * @param {Movement} movement
     * @param {number} velocity
     * @returns {number} pixels (positive)
     */
    static coastDistance(movement, velocity) {
        return CounterStrafeBody.stopProfile(movement, velocity, 0).distance;
    }

    /**
     * Runs the model from `velocity` with a fixed input until the body stops
     * (or would reverse).
     * @param {Movement} movement
     * @param {number} velocity
     * @param {number} dir
     * @returns {{distance:number, seconds:number}}
     */
    static stopProfile(movement, velocity, dir) {
        let v = velocity;
        let distance = 0;
        let seconds = 0;
        const sign = Math.sign(velocity);
        while (v !== 0 && Math.sign(v) === sign && seconds < 5) {
            v = CounterStrafeBody.step(movement, v, dir, PLAN_STEP);
            if (Math.sign(v) !== sign) {
                v = 0;
            }
            distance += Math.abs(v) * PLAN_STEP;
            seconds += PLAN_STEP;
        }
        return { distance, seconds };
    }

    /**
     * The furthest a player could travel in `seconds` while starting and
     * finishing at a dead stop: hold the key as long as the counter-strafe
     * can still stop in time, then counter-strafe.  The chart generator uses
     * this so it never writes a lane change that is physically impossible.
     *
     * @param {Movement} movement
     * @param {number} seconds
     * @returns {number} distance in pixels.
     */
    static maxDistance(movement, seconds) {
        if (seconds <= 0) {
            return 0;
        }
        let v = 0;
        let distance = 0;
        let elapsed = 0;
        while (elapsed + PLAN_STEP <= seconds) {
            const ahead = CounterStrafeBody.step(movement, v, 1, PLAN_STEP);
            const stop = CounterStrafeBody.stopProfile(movement, ahead, -1);
            if (elapsed + PLAN_STEP + stop.seconds > seconds) {
                break;
            }
            v = ahead;
            distance += v * PLAN_STEP;
            elapsed += PLAN_STEP;
        }
        return distance + CounterStrafeBody.stopProfile(movement, v, -1).distance;
    }
}
