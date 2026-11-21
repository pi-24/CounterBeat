/**
 * Results.js
 *
 * View-model and DOM helpers for the results screen: grade, accuracy, the
 * timing-error histogram with the mean early/late offset, stop-quality
 * stats and the Retry / Next / Menu actions.  The model is pure so it can be
 * unit tested; ResultScreen renders it.
 */
import { timingHistogram, describeOffset } from '../game/stats/histogram.js';
import { isPractice } from '../game/modes/practice.js';
import { el } from './format.js';

/**
 * @param {{record:object, timingErrorsMs?:number[], stopQuality?:{stopShots:number, stopGood:number},
 *   stars?:boolean[]|null, mode?:string, hasNext?:boolean, isReplay?:boolean}} input
 */
export function buildResultsView({ record, timingErrorsMs = [], stopQuality, stars = null, mode, hasNext = false, isReplay = false }) {
    const histogram = timingHistogram(timingErrorsMs);
    const shots = stopQuality?.stopShots ?? 0;
    const good = stopQuality?.stopGood ?? 0;
    const percent = shots > 0 ? Math.round((good / shots) * 100) : 0;
    return {
        grade: record.rank,
        accuracyText: `${(record.accuracy * 100).toFixed(1)}%`,
        stars,
        practice: isPractice(mode),
        offsetClass: !histogram.count || Math.abs(histogram.mean) < 0.5 ? '' : (histogram.mean < 0 ? 'is-early' : 'is-late'),
        histogram,
        offsetText: histogram.count ? `Mean offset: ${describeOffset(histogram.mean)}` : 'No shots fired',
        stopStats: {
            shots, good, percent,
            text: shots > 0 ? `${good} of ${shots} shots on a Perfect or Good stop (${percent}%)` : 'No shots fired',
        },
        actions: {
            retry: true,
            next: !isReplay && hasNext,
            menu: true,
        },
    };
}

/** Shots beyond the histogram range, e.g. "2 shots earlier than -100 ms, 1 later than +100 ms"; '' when none. */
export function outlierText(histogram) {
    const range = histogram.bins.length ? histogram.bins[histogram.bins.length - 1].to : 0;
    const parts = [];
    if (histogram.underflow) parts.push(`${histogram.underflow} earlier than -${range} ms`);
    if (histogram.overflow) parts.push(`${histogram.overflow} later than +${range} ms`);
    return parts.join(', ');
}

/**
 * Draws the histogram as plain bars; the dashed line marks the beat and the acid marker the mean.
 * @param {HTMLElement} host
 * @param {ReturnType<typeof timingHistogram>} histogram
 */
export function renderHistogram(host, histogram) {
    host.replaceChildren();
    const bars = el('div', 'result__hist-bars');
    for (const bin of histogram.bins) {
        const near = bin.from >= -10 && bin.to <= 10;
        const bar = el('span', `result__hist-bar${bin.from < 0 && bin.to <= 0 ? ' is-early' : bin.from >= 0 ? ' is-late' : ''}${near ? ' is-beat' : ''}`);
        bar.style.height = `${histogram.max ? Math.round((bin.count / histogram.max) * 100) : 0}%`;
        bar.title = `${bin.from} to ${bin.to} ms: ${bin.count}`;
        bars.append(bar);
    }
    bars.append(el('span', 'result__hist-zero'));
    if (histogram.count) {
        const mean = el('span', 'result__hist-mean');
        mean.style.left = `${meanMarkerPercent(histogram).toFixed(1)}%`;
        bars.append(mean);
    }
    const range = histogram.bins.length ? histogram.bins[histogram.bins.length - 1].to : 0;
    const axis = el('div', 'result__hist-axis mono');
    for (const label of [-range, -range / 2, 0, range / 2, range]) {
        axis.append(el('span', '', `${label > 0 ? '+' : (label < 0 ? '−' : '')}${Math.abs(label)}${label === range ? 'ms' : ''}`));
    }
    host.append(bars, axis);
    const outliers = outlierText(histogram);
    if (outliers) {
        host.append(el('div', 'result__hist-axis mono', outliers));
    }
}

/** Population standard deviation of the timing errors (ms); 0 for fewer than two shots. */
export function timingSd(errorsMs) {
    const values = errorsMs.filter(Number.isFinite);
    if (values.length < 2) {
        return 0;
    }
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

/** "MEAN −3ms · SD 11ms", or '' with no shots. */
export function meanSdText(errorsMs) {
    const values = errorsMs.filter(Number.isFinite);
    if (!values.length) {
        return '';
    }
    const mean = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
    const sign = mean < 0 ? '−' : (mean > 0 ? '+' : '');
    return `MEAN ${sign}${Math.abs(mean)}ms · SD ${Math.round(timingSd(values))}ms`;
}

/** Where the mean sits on the histogram, 0..100 (50 is the beat). */
export function meanMarkerPercent(histogram) {
    const range = histogram.bins.length ? histogram.bins[histogram.bins.length - 1].to : 0;
    if (!range) {
        return 50;
    }
    return Math.max(0, Math.min(100, 50 + (histogram.mean / range) * 50));
}

/**
 * Personal-best line: the gain over the previous best, or '' when the run is not a new best.
 * @param {number} previousBest 0 when there was none @param {number} score
 */
export function personalBestText(previousBest, score) {
    if (!(score > previousBest)) {
        return '';
    }
    if (!(previousBest > 0)) {
        return 'FIRST SCORE ON THIS CHART';
    }
    return `+${(score - previousBest).toLocaleString('en-GB')} PERSONAL BEST`;
}

/**
 * The four judgement cells, in the order of the frame: Perfect, Good, Loose, Missed.
 * @param {{perfect:number, good:number, loose:number, missed:number}} record
 */
export function judgementCells(record) {
    return [
        { key: 'perfect', label: 'PERFECT', value: record.perfect ?? 0 },
        { key: 'good', label: 'GOOD', value: record.good ?? 0 },
        { key: 'loose', label: 'LOOSE', value: record.loose ?? 0 },
        { key: 'miss', label: 'MISSED', value: record.missed ?? 0 },
    ];
}

/** The star glyph row: filled for earned stars. @param {boolean[]} stars */
export function starGlyphs(stars) {
    return stars.map((on) => (on ? '★' : '☆')).join('');
}
