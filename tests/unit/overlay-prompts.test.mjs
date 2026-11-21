import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAY_PROMPTS, mountOverlayPrompts, promptModel } from '../../src/ui/promptBar.js';

class El {
    constructor(tag) {
        this.tag = tag; this.children = []; this.dataset = {}; this.className = ''; this.textContent = ''; this.attrs = {};
        this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); } };
    }
    append(...n) { this.children.push(...n); }
    setAttribute(k, v) { this.attrs[k] = v; }
    querySelector() { return this.children.find((c) => c.className.split(' ').includes('prompt-bar')) ?? null; }
}
function fakeDoc(hosts) {
    return { createElement: (t) => new El(t), querySelectorAll: () => hosts };
}
const host = (name) => { const h = new El('div'); h.dataset.prompts = name; return h; };

test('every overlay prompt set has both a keyboard and a pad glyph on every row', () => {
    for (const [name, items] of Object.entries(OVERLAY_PROMPTS)) {
        assert.ok(items.length >= 2, name);
        assert.equal(promptModel(items).length, items.length, name);
        for (const i of items) assert.ok(i.keys.length && i.pad.length, `${name}/${i.label} needs both device glyphs`);
    }
});

test('mountOverlayPrompts adds one bar per known overlay, once', () => {
    const hosts = [host('pause'), host('help'), host('nope')];
    const doc = fakeDoc(hosts);
    assert.equal(mountOverlayPrompts(doc), 2);
    assert.equal(hosts[0].children.length, 1);
    assert.match(hosts[0].children[0].className, /prompt-bar prompt-bar--overlay|prompt-bar--overlay/);
    assert.equal(hosts[2].children.length, 0);
    assert.equal(mountOverlayPrompts(doc), 0, 'second call adds nothing');
});

test('the game page marks the four in-game overlays with a prompt set', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
    for (const [id, name] of [['pauseOverlay', 'pause'], ['helpOverlay', 'help'], ['resultOverlay', 'result'], ['calibrationOverlay', 'calibration']]) {
        assert.match(html, new RegExp(`id="${id}"[^>]*data-prompts="${name}"`));
        assert.ok(OVERLAY_PROMPTS[name]);
    }
});
