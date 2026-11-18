/** hudText.js - pure HUD strings and layout maths (Direction C), so they can be tested without a DOM. */

const MINUS = '−';

/** @param {number} judged @param {number} total @param {number} bpm the chart's own BPM */
export function progressLabel(judged, total, bpm) {
    return `Bot ${judged}/${total}  •  ${Math.round(bpm)} BPM`;
}

/** "14 / 32": the bot counter at top-centre. */
export function botCounter(judged, total) {
    return { current: String(Math.max(0, judged)), total: `/ ${Math.max(0, total)}` };
}

/**
 * The segmented progress bar under the bot counter: at most `max` segments, filled in proportion.
 * @returns {{count:number, done:number}}
 */
export function progressSegments(judged, total, max = 32) {
    const count = Math.max(0, Math.min(max, total));
    if (count === 0 || total <= 0) {
        return { count: 0, done: 0 };
    }
    return { count, done: Math.max(0, Math.min(count, Math.floor((judged / total) * count))) };
}

/** Whole multipliers read "×4", fractional ones "×1.5". */
export function multiplierLabel(multiplier) {
    return `×${Number(Number(multiplier).toFixed(2))}`;
}

/** "9/13": headshots over bots hit. */
export function headLabel(headshots, hits) {
    return `${headshots}/${hits}`;
}

/** Projected rank letter, or an en dash until the first bot is judged. */
export function paceLabel(rank, judged) {
    return judged > 0 && rank ? rank : '–';
}

/**
 * The stop meter, drawn to scale. The bar spans +/- `range` units/s around the planted centre and
 * the Perfect/Good/Loose zones sit at the locked thresholds (SPEED_GRADE) - never at a stylised width.
 * @param {{pinPoint:number, tight:number, loose:number}} grades
 * @param {number} [width] drawing width of the bar in SVG units
 */
export function stopMeterLayout(grades, width = 600) {
    const range = meterRange(grades);
    const perUnit = width / (range * 2);
    const zone = (speed) => ({ x: width / 2 - speed * perUnit, width: speed * 2 * perUnit });
    return {
        range,
        width,
        perUnit,
        perfect: zone(grades.pinPoint),
        good: zone(grades.tight),
        loose: zone(grades.loose),
    };
}

/** Half-range of the meter in units/s: the loose threshold plus a margin so the whole zone stays readable. */
export function meterRange(grades) {
    return grades.loose + 60;
}

/** Marker x on the meter for a signed velocity, clamped to the bar. */
export function meterMarkerX(velocity, grades, width = 600) {
    const range = meterRange(grades);
    const ratio = Math.max(-1, Math.min(1, velocity / range));
    return width / 2 + ratio * (width / 2);
}

/** "+12 u/s" / "−40 u/s" (signed along the strafe axis). */
export function stopReadout(velocity) {
    const rounded = Math.round(velocity);
    if (rounded === 0) {
        return '0 u/s';
    }
    return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded)} u/s`;
}

/** Signed milliseconds for the plate: negative is early. */
export function formatTimingMs(timingErrorSeconds) {
    if (typeof timingErrorSeconds !== 'number' || !Number.isFinite(timingErrorSeconds)) {
        return '';
    }
    const ms = Math.round(timingErrorSeconds * 1000);
    if (ms === 0) {
        return '0ms';
    }
    return `${ms < 0 ? MINUS : '+'}${Math.abs(ms)}ms`;
}

/**
 * Content of the judgement plate ("PERFECT −8ms [HEAD]").
 * @param {{grade:string, label:string, timingError?:number, headshot?:boolean, reason?:string}} input
 */
export function judgementPlate({ grade, label, timingError, headshot = false, reason = '' }) {
    return {
        tone: grade,
        label,
        ms: grade === 'miss' || grade === 'wild' ? '' : formatTimingMs(timingError),
        head: Boolean(headshot) && grade !== 'miss' && grade !== 'wild',
        reason,
    };
}

/** The "last 8" log: newest last. @param {string[]} log @param {string} grade */
export function pushRecent(log, grade, size = 8) {
    const next = [...log, grade];
    return next.slice(-size);
}

/**
 * The small line under the track title: difficulty (unless it just repeats the title) plus run tags.
 * @param {{name?:string, difficulty?:{name?:string}}} level
 */
export function hudDetail(level, replay = false, placeholder = false) {
    const parts = [];
    const diff = level?.difficulty?.name;
    if (diff && diff !== level?.name && diff !== level?.trackName) {
        parts.push(diff);
    }
    if (replay) {
        parts.push('REPLAY');
    }
    if (placeholder) {
        parts.push('PLACEHOLDER MUSIC');
    }
    return parts.join(' · ');
}

/**
 * True when an arena's sky is pale enough that the paper-coloured HUD ink would wash out against it
 * (the Range look). Rec. 709 luma of the 0..1 sky colour.
 * @param {number[]|undefined} sky [r, g, b], 0..1
 */
export function isLightSky(sky) {
    if (!Array.isArray(sky) || sky.length < 3) return false;
    return 0.2126 * sky[0] + 0.7152 * sky[1] + 0.0722 * sky[2] > 0.5;
}
