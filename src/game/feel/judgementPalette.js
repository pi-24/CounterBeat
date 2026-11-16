/**
 * judgementPalette.js - judgement colours and per-grade icons.  Two palettes:
 * 'neon' (default) and 'safe' (colour-blind-safe: no red versus green; GDD
 * section 7).  Every grade has a distinct shape, so colour is never the only
 * cue.
 */
export const PALETTES = Object.freeze({
    neon: Object.freeze({ perfect: '#7efcff', good: '#ffe14d', ok: '#ff9a3c', miss: '#ff3df2' }),
    safe: Object.freeze({ perfect: '#e8ffff', good: '#ffd400', ok: '#ff8c00', miss: '#b8a9d9' }),
});

export const PALETTE_IDS = Object.freeze(Object.keys(PALETTES));

/** Distinct icon per grade: diamond, circle, triangle, cross. */
export const GRADE_ICONS = Object.freeze({
    perfect: '◆',
    good: '●',
    ok: '▲',
    miss: '✖',
});

export function paletteFor(id) { return PALETTES[id] ?? PALETTES.neon; }
