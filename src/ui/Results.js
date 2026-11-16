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
 * Draws the histogram as plain bars; the zero line marks the beat.
 * @param {HTMLElement} host
 * @param {ReturnType<typeof timingHistogram>} histogram
 */
export function renderHistogram(host, histogram) {
    host.replaceChildren();
    const bars = el('div', 'result__hist-bars');
    for (const bin of histogram.bins) {
        const bar = el('span', `result__hist-bar${bin.from < 0 && bin.to <= 0 ? ' is-early' : bin.from >= 0 ? ' is-late' : ''}`);
        bar.style.height = `${histogram.max ? Math.round((bin.count / histogram.max) * 100) : 0}%`;
        bar.title = `${bin.from} to ${bin.to} ms: ${bin.count}`;
        bars.append(bar);
    }
    host.append(bars, el('div', 'result__hist-axis mono', 'EARLY  ←  0 ms  →  LATE'));
    const outliers = outlierText(histogram);
    if (outliers) {
        host.append(el('div', 'result__hist-axis mono', outliers));
    }
}
