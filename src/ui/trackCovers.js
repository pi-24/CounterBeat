/**
 * trackCovers.js - one geometric cover per track, pure SVG (no raster assets).
 * Acid ground, ink and paper shapes only, so a cover reads at 28 px and at 440 px
 * and follows the C design system. Colours come from CSS classes (.cv-a/.cv-k/.cv-p,
 * styled in game.css from the palette tokens), never from literals here.
 */

const stripes = (count, from = -100) => Array.from({ length: count }, (_, i) => {
    const x = from + i * 22;
    return `<path class="cv-k" d="M${x} 100 L${x + 12} 100 L${x + 112} 0 L${x + 100} 0 Z"/>`;
}).join('');

const ring = (r, inner) => `<circle class="cv-k" cx="50" cy="50" r="${r}"/><circle class="cv-p" cx="50" cy="50" r="${inner}"/>`;

/** Each cover is drawn on a 100 x 100 square over an acid ground. */
const COVERS = Object.freeze({
    // The Range: concentric target rings
    range: `<circle class="cv-k" cx="50" cy="50" r="42"/><circle class="cv-a" cx="50" cy="50" r="32"/><circle class="cv-k" cx="50" cy="50" r="22"/><circle class="cv-p" cx="50" cy="50" r="10"/>`,
    // Lo-fi Drift: stacked half discs, a slow wave
    drift: `<path class="cv-k" d="M0 70 A25 25 0 0 1 50 70 A25 25 0 0 1 100 70 V100 H0Z"/><path class="cv-p" d="M0 48 A25 25 0 0 1 50 48 A25 25 0 0 1 100 48 V56 H0Z"/><path class="cv-k" d="M0 26 A25 25 0 0 1 50 26 A25 25 0 0 1 100 26 V30 H0Z"/>`,
    // Neon Alley: diagonal stripes and a ring (the reference cover)
    neon: `${stripes(4, -70)}${ring(26, 12)}`,
    // Breakneck: chevrons
    breakneck: [0, 1, 2, 3].map((i) => `<path class="${i % 2 ? 'cv-p' : 'cv-k'}" d="M10 ${14 + i * 22} L50 ${34 + i * 22} L90 ${14 + i * 22} L90 ${26 + i * 22} L50 ${46 + i * 22} L10 ${26 + i * 22} Z"/>`).join(''),
    // Server Vault: a grid of blocks, one lit
    vault: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => `<rect class="${r === 1 && c === 1 ? 'cv-p' : 'cv-k'}" x="${14 + c * 26}" y="${14 + r * 26}" width="20" height="20"/>`)).join(''),
    // Overclock: rays out of a hub
    overclock: `${Array.from({ length: 8 }, (_, i) => `<path class="cv-k" transform="rotate(${i * 45} 50 50)" d="M46 50 L54 50 L58 0 L42 0 Z"/>`).join('')}<circle class="cv-a" cx="50" cy="50" r="16"/><circle class="cv-p" cx="50" cy="50" r="8"/>`,
});

export const COVER_IDS = Object.freeze(Object.keys(COVERS));

/**
 * @param {string} trackId a TRACKS id; unknown ids get the Range cover
 * @returns {string} an <svg> element as markup (static, no user text)
 */
export function coverSvg(trackId) {
    const id = Object.hasOwn(COVERS, trackId) ? trackId : 'range';
    return `<svg class="cover cover--${id}" viewBox="0 0 100 100" role="img" aria-label="${id} cover" focusable="false"><rect class="cv-a" width="100" height="100"/>${COVERS[id]}</svg>`;
}
