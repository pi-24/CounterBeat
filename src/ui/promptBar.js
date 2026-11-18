/**
 * promptBar.js - the bottom key/pad prompt bar of the C design system.
 * Every prompt carries both a keyboard glyph set and a pad glyph set; the CSS
 * (`.prompt-bar [data-device]`) shows the set matching <body data-input>, which
 * GameApp sets from the last input device (input/prompts.js). Pure model +
 * a small DOM renderer that only needs createElement, so it is unit-tested
 * without a browser.
 */
import { keyLabel } from '../game/input/bindings.js';
import { padLabel } from '../input/padBindings.js';

/** Prompts shared by the menu screens. */
export const MENU_PROMPTS = Object.freeze([
    { label: 'Navigate', keys: ['W', 'S'], pad: ['D-PAD'] },
    { label: 'Select', keys: ['ENTER'], pad: ['A'] },
    { label: 'Help', keys: ['H'], pad: ['Y'] },
    { label: 'Back', keys: ['ESC'], pad: ['B'] },
]);

/** @param {string} glyph a pad glyph text @returns {boolean} single characters are round buttons, longer ones are pills */
export function isRoundPadGlyph(glyph) {
    return String(glyph).length === 1;
}

/** @param {string} code a KeyboardEvent.code @returns {string} upper-case key cap text */
export function keyCap(code) {
    return keyLabel(code).toUpperCase();
}

/** @param {string} token a pad binding token @returns {string} short pad glyph text */
export function padCap(token) {
    return padLabel(token).toUpperCase();
}

/**
 * Normalises prompt items. Drops items with no label or no glyphs at all.
 * @param {Array<{label:string, keys?:string[], pad?:string[]}>} items
 * @returns {Array<{label:string, keys:string[], pad:string[]}>}
 */
export function promptModel(items) {
    return (items ?? [])
        .map((i) => ({ label: String(i?.label ?? '').trim(), keys: [...(i?.keys ?? [])].map(String), pad: [...(i?.pad ?? [])].map(String) }))
        .filter((i) => i.label && (i.keys.length || i.pad.length));
}

function node(doc, tag, className, text) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
}

/**
 * Builds the prompt bar element.
 * @param {{createElement:Function}} doc a Document
 * @param {Array<{label:string, keys?:string[], pad?:string[]}>} items
 * @param {{right?:string, fixed?:boolean}} [options] `right` is a mono caption on the far right
 * @returns {HTMLElement}
 */
export function renderPromptBar(doc, items, options = {}) {
    const bar = node(doc, 'div', options.fixed ? 'prompt-bar prompt-bar--fixed' : 'prompt-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Controls');
    for (const item of promptModel(items)) {
        const prompt = node(doc, 'span', 'prompt');
        if (item.keys.length) {
            const keys = node(doc, 'span', 'prompt__glyphs');
            keys.dataset.device = 'kbm';
            item.keys.forEach((k) => keys.append(node(doc, 'span', 'key', k)));
            prompt.append(keys);
        }
        if (item.pad.length) {
            const pad = node(doc, 'span', 'prompt__glyphs');
            pad.dataset.device = 'pad';
            item.pad.forEach((g) => pad.append(node(doc, 'span', isRoundPadGlyph(g) ? 'pad' : 'pad pad--wide', g)));
            prompt.append(pad);
        }
        prompt.append(node(doc, 'span', 'prompt__label', item.label));
        bar.append(prompt);
    }
    if (options.right) bar.append(node(doc, 'span', 'prompt-bar__right', options.right));
    return bar;
}

/** Song select: track, difficulty, play. */
export const SONG_PROMPTS = Object.freeze([
    { label: 'Track', keys: ['W', 'S'], pad: ['D-PAD'] },
    { label: 'Difficulty', keys: ['Q', 'E'], pad: ['LB', 'RB'] },
    { label: 'Play', keys: ['ENTER'], pad: ['A'] },
    { label: 'Help', keys: ['H'], pad: ['Y'] },
    { label: 'Back', keys: ['ESC'], pad: ['B'] },
]);

/** Settings and Your songs. */
export const PANEL_PROMPTS = Object.freeze([
    { label: 'Navigate', keys: ['W', 'S'], pad: ['D-PAD'] },
    { label: 'Select', keys: ['ENTER'], pad: ['A'] },
    { label: 'Back', keys: ['ESC'], pad: ['B'] },
]);
