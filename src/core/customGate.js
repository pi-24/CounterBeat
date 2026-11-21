/**
 * Ranked submit gate for custom songs (AC24). Lives in core so ScoreRepository
 * and the UI can both use it without core depending on ui/.
 */

/** @param {string} [chartId] @returns {boolean} */
export function isCustomChartId(chartId) {
    return typeof chartId === 'string' && chartId.startsWith('custom:');
}

/**
 * May this run/chart go to the ranked submission path?
 * @param {{kind?: string, chartId?: string, custom?: boolean}} run
 * @returns {{ok: boolean, reason?: string}}
 */
export function canSubmitRanked(run) {
    if (!run) return { ok: false, reason: 'no run' };
    if (run.kind === 'custom' || run.custom === true || isCustomChartId(run.chartId)) {
        return { ok: false, reason: 'custom songs are unranked (beta)' };
    }
    return { ok: true };
}
