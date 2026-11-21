/**
 * shopPreview.js - the Shop's live preview helpers, DOM-free where they can be:
 *   - botFrame(): which sprite-sheet frame a bot shows at a given time (idle loop, hit, death)
 *   - crosshairSvg(): an inline SVG of a crosshair manifest entry
 *   - themeSwatches(): the palette strip of an arena theme
 * The frame ranges match TargetField (idle 0-3, hit 4-5, death 6-9).
 */

import { PALETTE } from './palette.js';

export const BOT_FRAMES = Object.freeze({ idle: [0, 3], hit: [4, 5], death: [6, 9] });
export const IDLE_FRAME_MS = 170;
export const HIT_FRAME_MS = 90;
export const DEATH_FRAME_MS = 110;
/** The sheet is 5 cells wide (480 px / 96 px). */
export const SHEET_COLUMNS = 5;

/**
 * @param {{mode:'idle'|'hit'|'death', since:number}} state `since` is when the mode began, in ms
 * @param {number} now ms
 * @returns {{frame:number, mode:'idle'|'hit'|'death'}} hit returns to idle when done; death holds its last frame
 */
export function botFrame(state, now) {
    const elapsed = Math.max(0, now - state.since);
    if (state.mode === 'hit') {
        const [a, b] = BOT_FRAMES.hit;
        const step = Math.floor(elapsed / HIT_FRAME_MS);
        if (step <= b - a) return { frame: a + step, mode: 'hit' };
        return { frame: BOT_FRAMES.idle[0], mode: 'idle' };
    }
    if (state.mode === 'death') {
        const [a, b] = BOT_FRAMES.death;
        return { frame: Math.min(b, a + Math.floor(elapsed / DEATH_FRAME_MS)), mode: 'death' };
    }
    const [a, b] = BOT_FRAMES.idle;
    return { frame: a + (Math.floor(elapsed / IDLE_FRAME_MS) % (b - a + 1)), mode: 'idle' };
}

/** CSS background-position (in px) of a frame at `scale` x the cell size. */
export function framePosition(frame, cellWidth, cellHeight, scale) {
    return { x: -(frame % SHEET_COLUMNS) * cellWidth * scale, y: -Math.floor(frame / SHEET_COLUMNS) * cellHeight * scale };
}

/** Crosshair shapes the manifest uses (data/crosshairs.json). */
export const CROSSHAIR_SHAPES = Object.freeze(['dot', 'cross', 'gap-cross', 'ring', 'chevron', 'hex', 'diamond', 't-bar', 'square', 'dot-ring', 'bracket']);

/**
 * @param {string} shape
 * @param {string} colour a #rrggbb colour from the manifest
 * @returns {string} SVG markup, 100 x 100 viewBox
 */
export function crosshairSvg(shape, colour) {
    const c = /^#[0-9a-f]{3,8}$/i.test(colour) ? colour : PALETTE.secondary;
    const stroke = `fill="none" stroke="${c}" stroke-width="4" stroke-linecap="square"`;
    const parts = {
        dot: `<circle cx="50" cy="50" r="7" fill="${c}"/>`,
        cross: `<path ${stroke} d="M50 18V82M18 50H82"/>`,
        'gap-cross': `<path ${stroke} d="M50 14V38M50 62V86M14 50H38M62 50H86"/>`,
        ring: `<circle cx="50" cy="50" r="26" ${stroke}/>`,
        chevron: `<path ${stroke} d="M24 62L50 36L76 62"/>`,
        hex: `<path ${stroke} d="M50 20L76 35V65L50 80L24 65V35Z"/>`,
        diamond: `<path ${stroke} d="M50 18L82 50L50 82L18 50Z"/>`,
        't-bar': `<path ${stroke} d="M22 38H78M50 38V80"/>`,
        square: `<path ${stroke} d="M26 26H74V74H26Z"/>`,
        'dot-ring': `<circle cx="50" cy="50" r="28" ${stroke}/><circle cx="50" cy="50" r="5" fill="${c}"/>`,
        bracket: `<path ${stroke} d="M36 22H24V78H36M64 22H76V78H64"/>`,
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-hidden="true">${parts[shape] ?? parts.dot}</svg>`;
}

/** @param {{sky?:number[], accent?:number[]}} theme @returns {string[]} CSS rgb() colours, sky then accent */
export function themeSwatches(theme) {
    const css = ([r, g, b]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
    return [theme.sky, theme.accent, theme.fog?.colour].filter((v) => Array.isArray(v) && v.length === 3).map(css);
}
