/**
 * rangePalette.js
 *
 * The one place the 3D range gets its colours from (direction C "Bold Editorial": ink and graphite
 * space, paper-coloured lines, acid as the only bright accent, flat shading, almost no glow).
 * Arena, TargetField, Viewmodel and tools/build-art.mjs read it instead of holding colour literals;
 * the hex values come from src/ui/palette.js and must equal the tokens in styles/tokens.css
 * (tests/unit/palette-tokens.test.mjs checks both). No engine imports, so Node tools can use it too.
 *
 * Colours are plain [r, g, b] arrays in 0..1; the callers wrap them in Babylon Color3 / Color4.
 * Two looks exist: the dark ink range (Range, Neon) and the light bone range (Vault, tutorial),
 * where lines flip to ink and the additive glow effects flip to flat dark marks.
 */
import { PALETTE, hexToRgb01 } from '../../ui/palette.js';

/** Direction C swatches. ink2..ink4 and paper2 / acidDk mirror the tokens.css design-system palette. */
export const RANGE_HEX = Object.freeze({
    ink: PALETTE.ink,
    ink2: '#161614',
    ink3: '#22221f',
    ink4: '#34332e',
    paper: PALETTE.secondary,
    paper2: '#d9d3c5',
    dim: PALETTE.dim,
    mute: PALETTE.mute,
    acid: PALETTE.primary,
    acidDk: '#b8d000',
});

/** @param {keyof typeof RANGE_HEX} name @returns {number[]} [r, g, b] in 0..1 */
export const rangeRgb = (name) => hexToRgb01(RANGE_HEX[name]);

const scale = (rgb, k) => rgb.map((c) => c * k);
const NONE = [0, 0, 0];

/**
 * Colours for the range's moving parts.
 * @param {boolean} light true for a pale (bone) room
 * @param {number[]} accent theme accent as [r, g, b]
 */
export function rangeLook(light, accent) {
    const c = rangeRgb;
    if (light) {
        return {
            light: true,
            frameIdle: { diffuse: c('ink4'), emissive: NONE },
            frameActive: { diffuse: accent, emissive: scale(accent, 0.7) },
            padIdle: { diffuse: c('ink3'), emissive: NONE },
            padActive: { diffuse: accent, emissive: scale(accent, 0.6) },
            hemiGround: c('dim'),
            // set dressing stripes and LEDs: flat ink on bone, acid on ink
            mark: c('ink'),
            // idle ring is mid grey, the ring in the good window goes to full ink: a darker mark reads as "now"
            ring: { idle: c('mute'), close: c('ink') },
            sparks: { additive: false, normal: c('ink3'), bright: c('ink'), mid: c('mute'), dead: c('paper2') },
            tracer: { hit: c('ink'), miss: c('mute'), line: c('ink3') },
            flash: c('acid'),
        };
    }
    return {
        light: false,
        frameIdle: { diffuse: c('mute'), emissive: scale(c('mute'), 0.35) },
        frameActive: { diffuse: accent, emissive: scale(accent, 0.7) },
        padIdle: { diffuse: c('ink4'), emissive: c('ink3') },
        padActive: { diffuse: accent, emissive: scale(accent, 0.6) },
        hemiGround: c('ink4'),
        mark: accent,
        ring: { idle: accent, close: c('paper') },
        sparks: { additive: true, normal: c('paper2'), bright: c('acid'), mid: c('paper'), dead: c('ink') },
        tracer: { hit: c('acid'), miss: c('dim'), line: c('paper') },
        flash: c('acid'),
    };
}

/** Rifle materials: graphite body with an acid sight dot and stripe, readable on ink and on bone. */
export const RIFLE = Object.freeze({
    dark: rangeRgb('ink4'),
    mid: rangeRgb('mute'),
    accent: rangeRgb('acid'),
});
