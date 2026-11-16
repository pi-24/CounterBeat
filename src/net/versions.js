/**
 * Active chart versions (AC14): chartId -> version, from the shared chart
 * definitions. Authored Hard/Expert charts carry the version of their JSON
 * file (bumped when the audio source or chart changes); generated charts
 * (Easy, Normal, Daily) are 0.
 */
import { allTrackCharts, resolveChart } from '../game/rules/charts.js';

/** @returns {Record<string, number>} */
export function currentChartVersions() {
    const versions = {};
    for (const { chartId } of allTrackCharts()) {
        versions[chartId] = resolveChart(chartId)?.chartVersion ?? 0;
    }
    return versions;
}
