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
    replaceWith(next) {
        const i = this.parent.children.indexOf(this);
        next.parent = this.parent;
        this.parent.children[i] = next;
    }
    replaceChildren(...kids) { this.children = []; this.append(...kids.filter((k) => typeof k !== 'string')); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    click() { this.listeners.click?.(); }
    focus() { this.focused = true; this.listeners.focus?.(); }
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
    const primary = nav.querySelector('.mainmenu__primary').children;
    const more = nav.querySelector('.mainmenu__more').children;
    assert.deepEqual(primary.map((b) => b.children[0].textContent), ['Campaign', 'Quick Play', 'Daily', 'Ranked/Leaderboards']);
    // the ruled row: the remaining modes plus Shop, Credits and Quit (extras, not modes)
    assert.deepEqual(more.map((b) => b.dataset.menuItem), ['custom', 'practice', 'shop', 'settings', 'credits', 'quit']);
    const modes = [...primary, ...more].filter((b) => MENU_ITEMS.some((i) => i.id === b.dataset.menuItem));
    assert.deepEqual(modes.map((b) => b.dataset.menuItem), MENU_ITEMS.map((i) => i.id), 'the seven modes keep their order');
    assert.equal(MENU_ITEMS.length, 7);
    const main = primary;
    assert.ok(menu.classList.contains('menu--root'), 'the menu opens on the root list');
    // C design system: every row is a focus slab, and the prompt bar is mounted on the overlay
    assert.ok(main.every((b) => b.className.split(' ').includes('slab')), 'rows are slabs');
    assert.deepEqual(main.map((b) => b.children.at(-1).textContent), ['01', '02', '03', '04']);
    assert.ok(overlay.querySelector('.prompt-bar'), 'prompt bar mounted');
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
        nav.all((b) => b.dataset.menuItem === id)[0].click();
    }
    assert.deepEqual(modes, ['campaign', 'quickPlay', 'practice']);
});

test('Settings and Custom open their panel without switching the play mode or rebuilding song select', async () => {
    globalThis.document = { createElement: (tag) => new Node(tag) };
    const { MainMenu } = await import('../../src/ui/MainMenu.js');
    const overlay = new Node('div');
    const menu = new Node('div'); menu.className = 'menu';
    const panel = new Node('div'); panel.className = 'menu__panel'; panel.dataset.panel = 'settings';
    menu.append(panel); overlay.append(menu);
    const modes = [];
    const panels = [];
    new MainMenu(overlay, { onDaily() {}, onTutorial() {}, onMode: (m) => modes.push(m), onPanel: (p) => panels.push(p) }).mount();
    const nav = menu.querySelector('.mainmenu');
    for (const id of ['settings', 'custom']) {
        nav.all((b) => b.dataset.menuItem === id)[0].click();
    }
    assert.deepEqual(modes, []);
    assert.deepEqual(panels, ['settings', 'library']);
});

test('hovering an entry gives it DOM focus, so mouse, keyboard and pad share one cursor', async () => {
    globalThis.document = { createElement: (tag) => new Node(tag) };
    const { MainMenu } = await import('../../src/ui/MainMenu.js');
    const overlay = new Node('div');
    const menu = new Node('div'); menu.className = 'menu';
    const panel = new Node('div'); panel.className = 'menu__panel'; panel.dataset.panel = 'play';
    menu.append(panel); overlay.append(menu);
    new MainMenu(overlay, { onDaily() {}, onTutorial() {} }).mount();
    const nav = menu.querySelector('.mainmenu');
    const daily = nav.all((b) => b.dataset.menuItem === 'daily')[0];
    daily.listeners.mouseenter();
    assert.equal(daily.focused, true);
    assert.ok(daily.classList.contains('is-focus'));
});
