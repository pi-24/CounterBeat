/**
 * JS mirror of the design-system colours (direction C) for canvas/3D colours
 * (Babylon takes 0..1 floats). primary = acid, secondary = paper. Must equal
 * --acid / --paper in styles/tokens.css and data/art.json uiPalette;
 * tests/unit/palette-tokens.test.mjs enforces that.
 */
export const PALETTE = Object.freeze({
    primary: '#e2ff1f', // acid
    secondary: '#efeadf', // paper
    ink: '#0c0c0b',
    dim: '#a29d92',
    mute: '#6c6961',
});

/**
 * Grade colours by brightness (shape does the rest): single JS source for the judgement palettes
 * and the speed arc, derived from PALETTE so a retune is one edit (tokens.css + art.json + here).
 * `safe` pushes the four steps further apart and keeps every marker at 4.5:1 or better on ink
 * (checked in palette-tokens.test.mjs); the default Miss grey only needs the 3:1 graphical-object minimum.
 */
export const GRADE_COLOURS = Object.freeze({
    default: Object.freeze({ perfect: PALETTE.primary, good: PALETTE.secondary, ok: PALETTE.dim, miss: PALETTE.mute }),
    safe: Object.freeze({ perfect: PALETTE.primary, good: '#ffffff', ok: '#c4beb0', miss: '#8a857a' }),
});

/** @param {string} hex @returns {[number, number, number]} 0..1 floats */
export function hexToRgb01(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
