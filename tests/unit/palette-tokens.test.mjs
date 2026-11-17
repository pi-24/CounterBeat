import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');
const art = JSON.parse(readFileSync(resolve(root, 'data/art.json'), 'utf8'));
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('tokens define the direction C design system and judgement set', () => {
    for (const v of ['--ink', '--ink-2', '--ink-3', '--ink-4', '--paper', '--paper-2', '--dim', '--mute', '--acid', '--acid-dk',
        '--display', '--body', '--mono', '--c-bg', '--c-primary', '--c-secondary', '--j-perfect', '--j-good', '--j-loose', '--j-miss']) {
        assert.ok(tokens.includes(v + ':'), v);
    }
    assert.match(tokens, /--j-perfect: var\(--acid\)/);
    assert.match(tokens, /--j-good: var\(--paper\)/);
    assert.match(tokens, /--j-loose: var\(--dim\)/);
    assert.match(tokens, /--j-miss: var\(--mute\)/);
});

test('the old neon hues are gone from the UI tokens', () => {
    const css = stripComments(tokens).toLowerCase();
    for (const hex of ['#19e3ff', '#ff2fb3', '#070a14', '#0f1626']) assert.ok(!css.includes(hex), hex);
});

test('art.json uiPalette mirrors tokens.css and the JS palette', async () => {
    for (const [name, hex] of Object.entries(art.uiPalette.colours)) {
        assert.ok(tokens.includes(`--${name}: ${hex};`), `${name} ${hex}`);
    }
    const { PALETTE } = await import('../../src/ui/palette.js');
    assert.equal(PALETTE.primary, art.uiPalette.colours.acid);
    assert.equal(PALETTE.secondary, art.uiPalette.colours.paper);
    assert.equal(PALETTE.ink, art.uiPalette.colours.ink);
    assert.deepEqual(Object.values(art.uiPalette.judgements).map((j) => j.shape).sort(), ['circle', 'cross', 'diamond', 'triangle']);
});

test('judgements read by shape and brightness (grade palettes follow the design system)', async () => {
    const { PALETTES, GRADE_ICONS } = await import('../../src/game/feel/judgementPalette.js');
    const c = art.uiPalette.colours;
    assert.deepEqual({ ...PALETTES.default }, { perfect: c.acid, good: c.paper, ok: c.dim, miss: c.mute });
    assert.equal(new Set(Object.values(GRADE_ICONS)).size, 4);
    const { ARC_COLOURS } = await import('../../src/game/feel/speedArc.js');
    assert.deepEqual({ ...ARC_COLOURS }, { perfect: c.acid, good: c.paper, loose: c.dim, fast: c.mute });
    // the colour-blind-safe set must separate the four grades more than the default does
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
    const steps = (p) => [p.good, p.ok, p.miss].map(lum).map((v, i, a) => (i ? a[i - 1] - v : 0)).slice(1);
    assert.ok(Math.min(...steps(PALETTES.safe)) >= 35, 'safe palette keeps clear brightness steps');
    assert.notDeepEqual({ ...PALETTES.safe }, { ...PALETTES.default });
});

test('tactical look only changes 3D environment tokens, never the UI tokens', () => {
    const block = tokens.match(/\[data-look="tactical"\]\s*\{([^}]*)\}/);
    assert.ok(block, 'tactical block');
    for (const m of block[1].matchAll(/(--[\w-]+)\s*:/g)) assert.match(m[1], /^--env-/);
    assert.match(tokens, /--env-concrete:/);
});

test('fonts are self-hosted: no network font anywhere, licences shipped', () => {
    const fonts = readFileSync(resolve(root, 'src/styles/fonts.css'), 'utf8');
    // bare package imports (no hard-coded node_modules path), each resolving to a real installed CSS + woff2
    assert.doesNotMatch(fonts, /node_modules/);
    const imports = [...fonts.matchAll(/@import "(@fontsource\/[^"]+)"/g)].map((m) => m[1]);
    for (const family of ['anton', 'archivo', 'space-mono']) assert.ok(imports.some((i) => i.startsWith(`@fontsource/${family}/`)), family);
    for (const spec of imports) {
        const css = readFileSync(resolve(root, 'node_modules', spec), 'utf8');
        for (const m of css.matchAll(/url\(\.\/(files\/[^)]+\.woff2)\)/g)) {
            assert.ok(existsSync(resolve(root, 'node_modules', spec, '..', m[1])), `${spec}: ${m[1]}`);
        }
    }
    assert.doesNotMatch(fonts, /https?:\/\//);
    assert.match(tokens, /@import url\("\.\/fonts\.css"\)/);
    for (const f of art.fonts) {
        assert.match(readFileSync(resolve(root, f.licence), 'utf8'), /SIL OPEN FONT LICENSE/i, f.id);
    }
    assert.match(readFileSync(resolve(root, 'CREDITS.md'), 'utf8'), /## Fonts[\s\S]*Anton[\s\S]*Archivo[\s\S]*Space Mono/);
    for (const f of readdirSync(resolve(root, 'src/styles'))) {
        assert.doesNotMatch(readFileSync(resolve(root, 'src/styles', f), 'utf8'), /fonts\.g(oogleapis|static)/, f);
    }
});

test('shared components exist in components.css', () => {
    const css = readFileSync(resolve(root, 'src/styles/components.css'), 'utf8');
    for (const sel of ['.slab', '.slab__index', '.section-head', '.rule--thick', '.stat__value', '.prompt-bar', '.key', '.pad', '.shape--perfect',
        '.shape--good', '.shape--loose', '.shape--miss']) {
        assert.ok(css.includes(sel), sel);
    }
    assert.match(css, /\.slab:focus-visible::before/);
    assert.match(css, /body\[data-input="pad"\] \.prompt-bar \[data-device="kbm"\]/);
    assert.match(css, /body\[data-reduced-effects="true"\]/);
    const base = readFileSync(resolve(root, 'src/styles/base.css'), 'utf8');
    assert.match(base, /\.btn:focus-visible[\s\S]*?background: var\(--acid\)/);
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

test('no old cyan rgba literals in non-token stylesheets', () => {
    for (const f of ['base.css', 'layout.css', 'components.css', 'game.css']) {
        assert.doesNotMatch(readFileSync(resolve(root, 'src/styles', f), 'utf8'), /rgba\(\s*25,\s*227,\s*255/, f);
    }
});

test('look is cleared when leaving tactical', async () => {
    const { applyLook } = await import('../../src/ui/look.js');
    const el = { dataset: {} };
    applyLook('tactical', el);
    assert.equal(el.dataset.look, 'tactical');
    applyLook(null, el);
    assert.equal(el.dataset.look, undefined);
    assert.match(readFileSync(resolve(root, 'src/game/GameApp.js'), 'utf8'), /switchTo\(screen, look = null\)\s*\{\s*applyLook\(look\)/);
});

test('palette literals (hex/rgb/rgba) appear only in tokens.css and fonts.css has none', () => {
    const re = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
    for (const f of readdirSync(resolve(root, 'src/styles'))) {
        if (f === 'tokens.css' || !f.endsWith('.css')) continue;
        assert.doesNotMatch(stripComments(readFileSync(resolve(root, 'src/styles', f), 'utf8')), re, f);
    }
});

test('JS palette mirrors the CSS accents and Viewmodel has no raw accent literal', async () => {
    const { PALETTE } = await import('../../src/ui/palette.js');
    assert.ok(tokens.includes(`--acid: ${PALETTE.primary};`));
    assert.ok(tokens.includes(`--paper: ${PALETTE.secondary};`));
    const vm = readFileSync(resolve(root, 'src/game/fps/Viewmodel.js'), 'utf8');
    assert.doesNotMatch(vm, /new Color3\(0\.1,\s*0\.89/);
});

test('no auto-named --k-* tokens and no var() fallbacks to undefined tokens', () => {
    const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const f of readdirSync(resolve(root, 'src/styles'))) {
        const css = readFileSync(resolve(root, 'src/styles', f), 'utf8');
        assert.doesNotMatch(css, /--k-/, f);
        for (const m of css.matchAll(/var\((--c-[\w-]+|--mix-[\w-]+|--j-[\w-]+|--ink[\w-]*|--paper[\w-]*|--acid[\w-]*|--dim|--mute)/g)) {
            assert.ok(defined.has(m[1]), `${f}: ${m[1]} undefined`);
        }
    }
});

test('HUD mixes derive from the palette roles', () => {
    assert.match(tokens, /--mix-bg-\d+: color-mix\(in srgb, var\(--c-bg\)/);
});

test('only the tutorial mode sets the tactical look', () => {
    const src = readFileSync(resolve(root, 'src/game/GameApp.js'), 'utf8');
    assert.match(src, /mode === 'tutorial' \? 'tactical' : null/);
    assert.equal((src.match(/'tactical'/g) || []).length, 1);
});

test('the default crosshair and the markup crosshair use the acid accent, not a legacy colour', async () => {
    const { DEFAULT_SETTINGS } = await import('../../src/game/rules/config.js');
    assert.equal(DEFAULT_SETTINGS.crosshairColour, art.uiPalette.colours.acid);
    const html = readFileSync(resolve(root, 'game.html'), 'utf8');
    for (const m of html.matchAll(/(?:stroke|fill)="(#[0-9a-fA-F]{6})"/g)) assert.equal(m[1].toLowerCase(), art.uiPalette.colours.acid);
});

test('copy never names a colour that the palette no longer has', () => {
    for (const f of ['src/input/prompts.js', 'src/game/onboarding/tutorialStages.js', 'src/ui/Tutorial.js']) {
        assert.doesNotMatch(readFileSync(resolve(root, f), 'utf8'), /green/i, f);
    }
});

test('every prompt-bar class the renderer emits is styled, and nothing styled is dead', () => {
    const css = readFileSync(resolve(root, 'src/styles/components.css'), 'utf8');
    const src = readFileSync(resolve(root, 'src/ui/promptBar.js'), 'utf8');
    for (const cls of ['prompt-bar', 'prompt', 'prompt__glyphs', 'prompt__label', 'prompt-bar__right', 'key', 'pad', 'pad--wide']) {
        assert.ok(src.includes(cls), `${cls} emitted`);
        assert.ok(css.includes(`.${cls}`), `${cls} styled`);
    }
    assert.doesNotMatch(css, /prompt__sep/);
});

test('legacy hue tokens and classes are gone from every stylesheet and page', () => {
    const files = [...readdirSync(resolve(root, 'src/styles')).filter((f) => f.endsWith('.css')).map((f) => `src/styles/${f}`),
        ...readdirSync(root).filter((f) => f.endsWith('.html'))];
    for (const f of files) {
        const text = stripComments(readFileSync(resolve(root, f), 'utf8'));
        assert.doesNotMatch(text, /--c-(pink|mint|cyan)|badge--(mint|cyan|pink)/, f);
    }
});

test('no hard-coded rounding bypasses --radius (only true circles use 50%)', () => {
    for (const f of readdirSync(resolve(root, 'src/styles')).filter((x) => x.endsWith('.css'))) {
        for (const m of stripComments(readFileSync(resolve(root, 'src/styles', f), 'utf8')).matchAll(/border-radius:\s*([^;]+);/g)) {
            assert.match(m[1].trim(), /^(0|50%|var\(--radius(-lg)?\))$/, `${f}: ${m[1]}`);
        }
    }
});

test('CSS content strings are escapes or plain ASCII (no mojibake)', () => {
    for (const f of readdirSync(resolve(root, 'src/styles')).filter((x) => x.endsWith('.css'))) {
        const css = readFileSync(resolve(root, 'src/styles', f), 'utf8');
        assert.ok(!css.includes('�'), `${f} has U+FFFD`);
        for (const m of css.matchAll(/content:\s*(["'])([^"']*)/g)) {
            // allow intended symbols that live in the file as real characters (check mark) but never Latin-1 debris
            assert.doesNotMatch(m[2], /[-ÿ]/, `${f}: content ${JSON.stringify(m[2])}`);
        }
    }
    assert.match(readFileSync(resolve(root, 'src/styles/base.css'), 'utf8'), /\.btn--danger::before \{\s*content: "\\00D7"/);
    assert.match(readFileSync(resolve(root, 'src/styles/components.css'), 'utf8'), /\.field__error:not\(:empty\)::before \{\s*content: "\\00D7/);
});

test('mouse hover is clearly different from rest and from keyboard focus', () => {
    const base = readFileSync(resolve(root, 'src/styles/base.css'), 'utf8');
    assert.match(base, /\.btn:hover \{\s*background: var\(--paper\)/);
    assert.match(base, /@media \(forced-colors: active\)[\s\S]*?\.btn:focus-visible[\s\S]*?outline: 3px solid Highlight/);
});

test('contrast: markers and small labels on ink meet their WCAG minimum', async () => {
    const { PALETTE, GRADE_COLOURS } = await import('../../src/ui/palette.js');
    const rel = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const ratio = (a) => (rel(a) + 0.05) / (rel(PALETTE.ink) + 0.05);
    assert.ok(ratio(PALETTE.dim) >= 4.5, 'dim text (small mono labels)');
    for (const [grade, hex] of Object.entries(GRADE_COLOURS.safe)) assert.ok(ratio(hex) >= 4.5, `safe ${grade} ${ratio(hex).toFixed(2)}`);
    for (const [grade, hex] of Object.entries(GRADE_COLOURS.default)) assert.ok(ratio(hex) >= 3, `default ${grade} ${ratio(hex).toFixed(2)}`);
});
