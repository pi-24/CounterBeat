/** hudText.js - pure HUD strings, so they can be tested without a DOM. */

/** @param {number} judged @param {number} total @param {number} bpm the chart's own BPM */
export function progressLabel(judged, total, bpm) {
    return `Bot ${judged}/${total}  •  ${Math.round(bpm)} BPM`;
}
