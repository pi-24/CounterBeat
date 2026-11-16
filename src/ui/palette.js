/**
 * JS mirror of the two palette accents for canvas/3D colours (Babylon takes
 * 0..1 floats). Must equal --c-primary / --c-secondary in styles/tokens.css;
 * tests/unit/palette-tokens.test.mjs enforces that.
 */
export const PALETTE = Object.freeze({ primary: '#19e3ff', secondary: '#ff2fb3' });

/** @param {string} hex @returns {[number, number, number]} 0..1 floats */
export function hexToRgb01(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
