import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A tiny DOM, just enough for MainMenu.mount() (no jsdom in this project).
class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.className = ''; this.textContent = ''; this.parent = null; }
    get classList() {
        const n = this;
        return {
            add: (c) => { if (!n.className.split(' ').includes(c)) n.className = `${n.className} ${c}`.trim(); },
            remove: (c) => { n.className = n.className.split(' ').filter((x) => x && x !== c).join(' '); },
            contains: (c) => n.className.split(' ').includes(c),
            toggle: (c, on) => { n.className = n.className.split(' ').filter((x) => x && x !== c).join(' '); if (on) n.className = `${n.className} ${c}`.trim(); },
        };
    }
    append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
    before(...kids) {
        const i = this.parent.children.indexOf(this);
        for (const k of kids) k.parent = this.parent;
        this.parent.children.splice(i, 0, ...kids);
    }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    click() { this.listeners.click?.(); }
    setAttribute() {}
    all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
    querySelectorAll(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1).split('[')[0] : null;
        return this.all((n) => cls && n.className.split(' ').includes(cls));
    }
    querySelector(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1).split('[')[0] : null;
        return this.all((n) => cls && n.className.split(' ').includes(cls))[0] ?? null;
    }
}

test('the rendered main menu lists exactly the seven configured entries, in order', async () => {
    globalThis.document = { createElement: (tag) => new Node(tag) };
    const { MainMenu } = await import('../../src/ui/MainMenu.js');
    const { MENU_ITEMS } = await import('../../src/ui/menuConfig.js');
    const overlay = new Node('div');
    const menu = new Node('div'); menu.className = 'menu';
    const panel = new Node('div'); panel.className = 'menu__panel'; panel.dataset.panel = 'play';
    menu.append(panel); overlay.append(menu);
    new MainMenu(overlay, { onDaily() {}, onTutorial() {} }).mount();

    const nav = menu.querySelector('.mainmenu');
    const main = nav.children.filter((b) => !b.className.includes('mainmenu__item--minor'));
    const labels = main.map((b) => b.children[0].textContent);
    assert.deepEqual(labels, ['Campaign', 'Quick Play', 'Daily', 'Ranked/Leaderboards', 'Custom (Beta)', 'Practice', 'Settings']);
    assert.deepEqual(labels, MENU_ITEMS.map((i) => i.label));
    assert.ok(menu.classList.contains('menu--root'), 'the menu opens on the root list');
});

test('no legacy tab row exists in the markup, script or styles', () => {
    const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const f of ['../../game.html', '../../src/styles/game.css', '../../src/game/GameApp.js', '../../src/ui/MainMenu.js']) {
        assert.doesNotMatch(read(f), /menu__tab/, f);
    }
});

test('Campaign, Quick Play and Practice open the track list in their own mode', async () => {
    globalThis.document = { createElement: (tag) => new Node(tag) };
    const { MainMenu } = await import('../../src/ui/MainMenu.js');
    const overlay = new Node('div');
    const menu = new Node('div'); menu.className = 'menu';
    const panel = new Node('div'); panel.className = 'menu__panel'; panel.dataset.panel = 'play';
    menu.append(panel); overlay.append(menu);
    const modes = [];
    new MainMenu(overlay, { onDaily() {}, onTutorial() {}, onMode: (m) => modes.push(m) }).mount();
    const nav = menu.querySelector('.mainmenu');
    for (const id of ['campaign', 'quickplay', 'practice']) {
        nav.children.find((b) => b.dataset.menuItem === id).click();
    }
    assert.deepEqual(modes, ['campaign', 'quickPlay', 'practice']);
});
