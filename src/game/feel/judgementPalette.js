/**
 * judgementPalette.js - judgement colours and per-grade icons.  Direction C:
 * grades read by shape + brightness (acid diamond, paper circle, dim triangle,
 * grey cross), never by hue alone.  Two palettes: 'default' (the design-system
 * set; the legacy saved id 'neon' is migrated by migratePaletteId) and 'safe'
 * (a higher-contrast variant of the same shape + brightness idea).
 */
import { GRADE_COLOURS } from '../../ui/palette.js';

export const PALETTES = Object.freeze({
    default: GRADE_COLOURS.default,
    safe: GRADE_COLOURS.safe,
});

export const PALETTE_IDS = Object.freeze(Object.keys(PALETTES));

/** Distinct icon per grade: diamond, circle, triangle, cross. */
export const GRADE_ICONS = Object.freeze({
    perfect: '◆',
    good: '●',
    ok: '▲',
    miss: '✖',
});

/** Saved settings from before Direction C store the default set as 'neon'; it now means 'default'. */
export function migratePaletteId(id) { return id === 'neon' ? 'default' : id; }

export function paletteFor(id) { return PALETTES[migratePaletteId(id)] ?? PALETTES.default; }
