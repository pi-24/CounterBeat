import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptModel, renderPromptBar, isRoundPadGlyph, keyCap, padCap, MENU_PROMPTS } from '../../src/ui/promptBar.js';

class El {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.className = ''; this.textContent = ''; this.attrs = {}; }
    append(...n) { this.children.push(...n); }
    setAttribute(k, v) { this.attrs[k] = v; }
}
const doc = { createElement: (t) => new El(t) };

test('promptModel drops empty items and normalises glyph lists', () => {
    const m = promptModel([{ label: ' Select ', keys: ['ENTER'], pad: ['A'] }, { label: '', keys: ['X'] }, { label: 'Nothing' }, { label: 'Keys only', keys: ['Q'] }]);
    assert.deepEqual(m.map((i) => i.label), ['Select', 'Keys only']);
    assert.deepEqual(m[1].pad, []);
    assert.deepEqual(promptModel(undefined), []);
});

test('pad glyph shape: single characters are round, names are pills', () => {
    assert.ok(isRoundPadGlyph('A'));
    assert.ok(!isRoundPadGlyph('D-PAD'));
    assert.ok(!isRoundPadGlyph('LB'));
});

test('key and pad caps are short upper-case text', () => {
    assert.equal(keyCap('KeyA'), 'A');
    assert.equal(keyCap('Space'), 'SPACE');
    assert.equal(padCap('B0'), 'A');
    assert.equal(padCap('B5'), 'RB');
});

test('renderPromptBar emits both device sets so CSS can switch with the last input device', () => {
    const bar = renderPromptBar(doc, MENU_PROMPTS, { right: 'NOW PLAYING', fixed: true });
    assert.equal(bar.className, 'prompt-bar prompt-bar--fixed');
    assert.equal(bar.children.length, MENU_PROMPTS.length + 1);
    const select = bar.children[1];
    const [kb, pad, label] = select.children;
    assert.equal(kb.dataset.device, 'kbm');
    assert.equal(kb.children[0].className, 'key');
    assert.equal(kb.children[0].textContent, 'ENTER');
    assert.equal(pad.dataset.device, 'pad');
    assert.equal(pad.children[0].className, 'pad');
    assert.equal(label.textContent, 'Select');
    assert.equal(bar.children[0].children[1].children[0].className, 'pad pad--wide');
    assert.equal(bar.children.at(-1).className, 'prompt-bar__right');
});

test('every shipped prompt glyph is plain ASCII, so no font can render a missing-glyph box', () => {
    for (const item of MENU_PROMPTS) {
        for (const g of [...item.keys, ...item.pad]) assert.match(g, /^[\x20-\x7e]+$/, `${item.label}: ${JSON.stringify(g)}`);
    }
    assert.deepEqual(MENU_PROMPTS[0].keys, ['W', 'S']);
});
