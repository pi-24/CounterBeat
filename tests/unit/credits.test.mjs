import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateAll, loadManifest, imageRefs, canonicalImageRef } from '../../tools/validate-assets.mjs';
import { currentCredits } from '../../tools/gen-credits.mjs';
import { buildCredits } from '../../src/ui/creditsData.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const all = () => Object.fromEntries(['tracks', 'themes', 'targets', 'crosshairs', 'art'].map((n) => [n, loadManifest(`${n}.json`, ROOT)]));

test('CREDITS.md is current and lists every entry with a licence', () => {
    assert.equal(readFileSync(join(ROOT, 'CREDITS.md'), 'utf8'), currentCredits());
    for (const e of buildCredits(all())) assert.ok(e.licence, e.name);
});

test('validator fails on missing licence, unknown image and stale credits', () => {
    const m = all();
    m.themes.themes[0].licence = 'LICENSES/nope.txt';
    delete m.targets.targets[0].licence;
    const errs = validateAll({ manifests: m });
    assert.ok(errs.some((e) => /theme range.*licence file/.test(e)));
    assert.ok(errs.some((e) => /target bot.*missing licence/.test(e)));
    assert.ok(errs.some((e) => /CREDITS.md is stale/.test(e)));
    const m2 = all();
    m2.art.images = [];
    assert.ok(validateAll({ manifests: m2 }).some((e) => /emblem.png is not in any manifest/.test(e)));
});

test('imageRefs ignores comments and finds url/img/import', () => {
    const refs = imageRefs('/* example.png */ // other.png' + String.fromCharCode(10) + '.a{background:url("images/a.png")} <img src="b.png"> import x from "./c.png";');
    assert.deepEqual(refs.sort(), ['./c.png', 'b.png', 'images/a.png']);
});

test('canonicalImageRef resolves to public-relative and does not suffix-match', () => {
    assert.equal(canonicalImageRef('/images/bot-sheet.png', ROOT, ROOT), 'images/bot-sheet.png');
    assert.equal(canonicalImageRef('foo/bot-sheet.png', ROOT, ROOT), 'foo/bot-sheet.png');
    assert.equal(canonicalImageRef('https://x/y.png', ROOT, ROOT), null);
});

test('validator fails on a stray src image reference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cb-'));
    cpSync(join(ROOT, 'data'), join(dir, 'data'), { recursive: true });
    cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
    cpSync(join(ROOT, 'LICENSES'), join(dir, 'LICENSES'), { recursive: true });
    cpSync(join(ROOT, 'CREDITS.md'), join(dir, 'CREDITS.md'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/a.css'), '.x{background:url(/stray/bot-sheet.png)}');
    const errs = validateAll({ root: dir });
    assert.ok(errs.some((e) => e.includes('stray/bot-sheet.png')), errs.join(', '));
});

test('validator fails on stale level thumbnails and unlisted packs; pending licences are flagged', () => {
    const m = all();
    m.themes.themes[0].thumbSource = 'deadbeef';
    assert.ok(validateAll({ manifests: m }).some((e) => /thumb is stale/.test(e)));
    const m2 = all();
    m2.art.packs = [];
    assert.ok(validateAll({ manifests: m2 }).some((e) => /not listed in art.json packs/.test(e)));
    const credits = buildCredits(all());
    assert.ok(credits.every((e) => !/pending/.test(e.note)));
    assert.ok(credits.some((e) => e.category === 'Art packs' && /kenney\.nl/.test(e.name)));
});

// --- CreditsScreen UI (tiny DOM stub; no jsdom in this project) ---
class StubNode {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.className = ''; this.textContent = ''; this.hidden = false; this.isConnected = true; this.focused = false; }
    append(...k) { this.children.push(...k); }
    setAttribute() {}
    addEventListener(t, fn) { this.listeners[t] = fn; }
    focus() { globalThis.document.activeElement = this; }
    all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
    querySelectorAll(sel) {
        if (sel.startsWith('button')) return this.all((n) => n.tag === 'button');
        return this.all((n) => n.className.split(' ').includes(sel.replace('.', '')));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
    contains(n) { return n === this || this.all((c) => c === n).length > 0; }
}

test('CreditsScreen renders one list item per credit, Escape closes and refocuses the opener', async () => {
    globalThis.document = { createElement: (t) => new StubNode(t), activeElement: null };
    const { CreditsScreen } = await import('../../src/ui/CreditsScreen.js');
    const CREDITS = buildCredits(Object.fromEntries(['tracks', 'themes', 'targets', 'crosshairs', 'art'].map((n) => [n, loadManifest(`${n}.json`, ROOT)])));
    const parent = new StubNode('div');
    const screen = new CreditsScreen(parent, CREDITS);
    assert.equal(parent.children[0], screen.root);
    assert.equal(screen.root.hidden, true);
    const items = screen.root.all((n) => n.className === 'credits__item');
    assert.equal(items.length, CREDITS.length);
    assert.ok(CREDITS.some((c) => /Kenney/.test(c.author)));
    const opener = new StubNode('button');
    screen.open(opener);
    assert.equal(screen.root.hidden, false);
    assert.equal(document.activeElement, screen.root);
    let prevented = false;
    screen.root.listeners.keydown({ key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation() {} });
    assert.ok(prevented);
    assert.equal(screen.root.hidden, true);
    assert.equal(document.activeElement, opener);
    delete globalThis.document;
});

test('no source file still reads the old targets.sparkTexture manifest key', () => {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    for (const f of ['src', 'tools', 'supabase', 'tests'].filter((d) => existsSync(d)).flatMap(walk).filter((x) => /.(js|mjs|ts)$/.test(x) && !x.endsWith('credits.test.mjs'))) {
        assert.ok(!/(targets|manifest)\w*\.sparkTexture/.test(readFileSync(f, 'utf8')), f);
    }
    const t = JSON.parse(readFileSync('data/targets.json', 'utf8'));
    assert.ok(t.spark?.path);
    assert.equal(t.sparkTexture, undefined);
});
