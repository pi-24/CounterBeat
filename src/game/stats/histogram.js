/**
 * histogram.js
 *
 * Timing-error statistics for the results screen and the practice readout.
 * Errors are in milliseconds, negative = early, positive = late (the same
 * sign as Judge's `timingError`, which is songTime - note.time).
 */

export const DEFAULT_BIN_MS = 10;
export const DEFAULT_RANGE_MS = 100;

/**
 * @param {number[]} errorsMs
 * @returns {number} mean error in ms (0 for no data)
 */
export function meanError(errorsMs) {
    const values = errorsMs.filter(Number.isFinite);
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Buckets errors into equal bins across [-range, +range]. Errors outside the
 * range are counted separately (underflow / overflow), never folded into the end bins.
 * @param {number[]} errorsMs
 * @param {{binMs?:number, rangeMs?:number}} [options]
 * @returns {{bins:{from:number,to:number,count:number}[], count:number, mean:number,
 *   early:number, late:number, max:number, underflow:number, overflow:number}}
 */
export function timingHistogram(errorsMs, { binMs = DEFAULT_BIN_MS, rangeMs = DEFAULT_RANGE_MS } = {}) {
    const values = errorsMs.filter(Number.isFinite);
    const binCount = Math.max(1, Math.round((rangeMs * 2) / binMs));
    const bins = Array.from({ length: binCount }, (_, i) => ({
        from: -rangeMs + i * binMs,
        to: -rangeMs + (i + 1) * binMs,
        count: 0,
    }));
    let early = 0;
    let late = 0;
    let underflow = 0;
    let overflow = 0;
    for (const v of values) {
        if (v < 0) early += 1;
        else if (v > 0) late += 1;
        if (v < -rangeMs) {
            underflow += 1;
        } else if (v >= rangeMs) {
            overflow += 1;
        } else {
            bins[Math.floor((v + rangeMs) / binMs)].count += 1;
        }
    }
    return {
        bins, count: values.length, mean: meanError(values), early, late, underflow, overflow,
        max: bins.reduce((m, b) => Math.max(m, b.count), 0),
    };
}

/**
 * Human text for a mean offset, e.g. "12 ms late", "3 ms early", "on the beat".
 * @param {number} meanMs
 */
export function describeOffset(meanMs) {
    const rounded = Math.round(Math.abs(meanMs));
    if (rounded === 0) {
        return 'on the beat';
    }
    return `${rounded} ms ${meanMs < 0 ? 'early' : 'late'}`;
}
