/**
 * flashLimiter.js - caps flashes per rolling second.
 * Shared by every effect that flashes, so the total stays <= maxPerSecond.
 */
export const MAX_FLASHES_PER_SECOND = 3;

export class FlashLimiter {
    /** @param {number} [maxPerSecond] */
    constructor(maxPerSecond = MAX_FLASHES_PER_SECOND) {
        this.max = Math.min(maxPerSecond, MAX_FLASHES_PER_SECOND);
        /** @type {number[]} */
        this.times = [];
    }

    /**
     * @param {number} nowSeconds monotonic time
     * @returns {boolean} true when a flash may play now (and is recorded)
     */
    tryFlash(nowSeconds) {
        this.times = this.times.filter((t) => nowSeconds - t < 1);
        if (this.times.length >= this.max) return false;
        this.times.push(nowSeconds);
        return true;
    }

    reset() { this.times = []; }
}
