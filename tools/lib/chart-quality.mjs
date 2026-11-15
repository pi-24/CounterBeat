/**
 * chart-quality.mjs - musical-quality checks for the authored Hard/Expert
 * charts (charts/<track>/<difficulty>.json). Shared by tools/author-charts.mjs
 * (to reject a bad realisation), tools/chart-stats.mjs and the unit tests.
 *
 *  - lane coverage: every lane carries >= 8% of the notes
 *  - lane runs: no more than 6 consecutive notes in one lane
 *  - motifs: no bar (rhythm + lanes) repeated more than twice in a row
 *  - phrase variation: no 4-bar phrase is followed by an identical 4-bar phrase
 *  - fast same-lane: no more than 3 consecutive same-lane links closer than the 320 ms counter-strafe window
 *  - figure share: no single rhythm figure fills more than 35% of the bars
 *  - density: Expert >= 3.2 notes/s, Hard within +-10% of 2.4
 */
export const QUALITY = { minLaneShare: 0.08, maxLaneRun: 6, maxBarRepeat: 2, phraseBars: 4, maxFastSameLane: 3, fastSec: 0.32, maxFigureShare: 0.35, hardTarget: 2.4, expertMin: 3.2 };

function barSignatures(notes) {
    const bars = new Map();
    for (const [b, l] of notes) {
        const k = Math.floor(b / 4);
        if (!bars.has(k)) bars.set(k, []);
        bars.get(k).push(`${b % 4}:${l}`);
    }
    return bars;
}

/** Returns a list of human-readable problems (empty = musically ok). */
export function chartQualityProblems(chart, difficulty) {
    const { notes, lanes } = chart;
    const problems = [];
    const n = notes.length;
    const counts = new Array(lanes).fill(0);
    notes.forEach(([, l]) => { counts[l] += 1; });
    counts.forEach((k, l) => {
        if (k / n < QUALITY.minLaneShare) problems.push(`lane ${l} has ${k}/${n} notes (< ${QUALITY.minLaneShare * 100}%)`);
    });
    let run = 1;
    let max = 1;
    for (let i = 1; i < n; i += 1) {
        run = notes[i][1] === notes[i - 1][1] ? run + 1 : 1;
        max = Math.max(max, run);
    }
    if (max > QUALITY.maxLaneRun) problems.push(`${max}-note single-lane run (> ${QUALITY.maxLaneRun})`);

    let fast = 0;
    let maxFast = 0;
    const spb = 60 / chart.bpm;
    for (let i = 1; i < n; i += 1) {
        const close = (notes[i][0] - notes[i - 1][0]) * spb < QUALITY.fastSec && notes[i][1] === notes[i - 1][1];
        fast = close ? fast + 1 : 0;
        maxFast = Math.max(maxFast, fast);
    }
    if (maxFast > QUALITY.maxFastSameLane) problems.push(`${maxFast + 1}-note same-lane burst inside the 320 ms stop window`);
    const rhythms = new Map();
    const barRhythm = new Map();
    for (const [b] of notes) { const k = Math.floor(b / 4); barRhythm.set(k, `${barRhythm.get(k) || ''}${b % 4},`); }
    for (const r of barRhythm.values()) rhythms.set(r, (rhythms.get(r) || 0) + 1);
    if (Math.max(...rhythms.values()) / barRhythm.size > QUALITY.maxFigureShare) problems.push('one rhythm figure fills > 35% of the chart');

    const bars = barSignatures(notes);
    const last = Math.max(...bars.keys());
    const sig = [];
    for (let k = 0; k <= last; k += 1) sig.push(bars.has(k) ? bars.get(k).join(',') : '');
    let rep = 1;
    for (let k = 1; k <= last; k += 1) {
        rep = sig[k] !== '' && sig[k] === sig[k - 1] ? rep + 1 : 1;
        if (rep > QUALITY.maxBarRepeat) { problems.push(`bar ${k} repeats a motif ${rep} times in a row`); break; }
    }
    const P = QUALITY.phraseBars;
    for (let k = 0; k + 2 * P <= last + 1; k += 1) {
        const a = sig.slice(k, k + P).join('|');
        if (a.replace(/\|/g, '') !== '' && a === sig.slice(k + P, k + 2 * P).join('|')) {
            problems.push(`phrase at bar ${k} is repeated verbatim`);
            break;
        }
    }
    const nps = n / ((chart.bars - chart.firstNoteBar) * 4 * (60 / chart.bpm));
    if (difficulty === 'expert' && nps < QUALITY.expertMin) problems.push(`${nps.toFixed(2)} n/s < ${QUALITY.expertMin}`);
    if (difficulty === 'hard' && Math.abs(nps - QUALITY.hardTarget) > QUALITY.hardTarget * 0.1) problems.push(`${nps.toFixed(2)} n/s not within 10% of ${QUALITY.hardTarget}`);
    return problems;
}
