import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');

test('tokens define neon palette and tactical override', () => {
    for (const v of ['--c-bg', '--c-primary', '--c-secondary', '--j-perfect', '--j-good', '--j-loose', '--j-miss']) {
        assert.ok(tokens.includes(v + ':'), v);
    }
    assert.match(tokens, /\[data-look="tactical"\]/);
});

test('every html page imports tokens.css before base.css', () => {
    const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
    assert.ok(pages.length >= 7);
    for (const p of pages) {
        const t = readFileSync(resolve(root, p), 'utf8');
        const a = t.indexOf('styles/tokens.css');
        assert.ok(a >= 0, p);
        assert.ok(a < t.indexOf('styles/base.css'), p);
    }
});

test('other stylesheets do not redefine palette tokens', () => {
    for (const f of ['base.css', 'layout.css', 'components.css', 'game.css']) {
        assert.doesNotMatch(readFileSync(resolve(root, 'src/styles', f), 'utf8'), /--c-(bg|surface|primary|secondary|accent)\s*:/, f);
    }
});

test('no cyan rgba literals in non-token stylesheets', () => {
    for (const f of ['base.css', 'layout.css', 'components.css', 'game.css']) {
        assert.doesNotMatch(readFileSync(resolve(root, 'src/styles', f), 'utf8'), /rgba\(\s*25,\s*227,\s*255/, f);
    }
});

test('look is cleared when leaving tactical', async () => {
    const { applyLook } = await import('../../src/ui/look.js');
    const root = { dataset: {} };
    applyLook('tactical', root);
    assert.equal(root.dataset.look, 'tactical');
    applyLook(null, root);
    assert.equal(root.dataset.look, undefined);
    assert.match(readFileSync(resolve(root_dir(), 'src/game/GameApp.js'), 'utf8'), /switchTo\(screen, look = null\)\s*\{\s*applyLook\(look\)/);
});
function root_dir() { return resolve(import.meta.dirname, '../..'); }

test('palette literals (hex/rgb/rgba) appear only in tokens.css', () => {
    const re = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
    for (const f of readdirSync(resolve(root, 'src/styles'))) {
        if (f === 'tokens.css' || !f.endsWith('.css')) continue;
        const css = readFileSync(resolve(root, 'src/styles', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(css, re, f);
    }
});

test('JS palette mirrors the CSS accents and Viewmodel has no raw accent literal', async () => {
    const { PALETTE } = await import('../../src/ui/palette.js');
    assert.ok(tokens.includes(`--c-primary: ${PALETTE.primary};`));
    assert.ok(tokens.includes(`--c-secondary: ${PALETTE.secondary};`));
    const vm = readFileSync(resolve(root, 'src/game/fps/Viewmodel.js'), 'utf8');
    assert.doesNotMatch(vm, /new Color3\(0\.1,\s*0\.89/);
});

test('no auto-named --k-* tokens and no var() fallbacks to undefined tokens', () => {
    const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const f of readdirSync(resolve(root, 'src/styles'))) {
        const css = readFileSync(resolve(root, 'src/styles', f), 'utf8');
        assert.doesNotMatch(css, /--k-/, f);
        for (const m of css.matchAll(/var\((--c-[\w-]+|--mix-[\w-]+|--j-[\w-]+)/g)) {
            assert.ok(defined.has(m[1]), `${f}: ${m[1]} undefined`);
        }
    }
});

test('tactical look derives HUD mixes from the same overridden tokens', () => {
    assert.match(tokens, /--mix-bg-\d+: color-mix\(in srgb, var\(--c-bg\)/);
});

test('only the tutorial mode sets the tactical look', () => {
    const src = readFileSync(resolve(root, 'src/game/GameApp.js'), 'utf8');
    assert.match(src, /mode === 'tutorial' \? 'tactical' : null/);
    assert.equal((src.match(/'tactical'/g) || []).length, 1);
});
