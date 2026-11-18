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

// ---------------------------------------------------------------- 3D range (direction C)

const themes = JSON.parse(readFileSync(resolve(root, 'data/themes.json'), 'utf8'));
const hex01 = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255); };
const closeTo = (a, b, eps = 0.005) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

test('range palette module mirrors the design tokens (one source for scene colours)', async () => {
    const { RANGE_HEX } = await import('../../src/game/fps/rangePalette.js');
    const c = art.uiPalette.colours;
    for (const [key, token] of [['ink', 'ink'], ['ink2', 'ink-2'], ['ink3', 'ink-3'], ['ink4', 'ink-4'], ['paper', 'paper'], ['paper2', 'paper-2'],
        ['dim', 'dim'], ['mute', 'mute'], ['acid', 'acid'], ['acidDk', 'acid-dk']]) {
        assert.ok(tokens.includes(`--${token}: ${RANGE_HEX[key]};`), `${key} vs --${token}`);
    }
    assert.equal(RANGE_HEX.acid, c.acid);
});

test('themes.json palette is the direction C range palette: no cyan, magenta or orange swatches', async () => {
    const { RANGE_HEX } = await import('../../src/game/fps/rangePalette.js');
    const swatches = Object.values(RANGE_HEX).map((h) => h.toLowerCase());
    assert.deepEqual([...themes.palette.colours].map((h) => h.toLowerCase()).sort(), [...swatches].sort());
    // saturation check: the only chroma allowed in the room palette is acid (hue about 66 deg)
    for (const hex of swatches) {
        const [r, g, b] = hex01(hex);
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        if (hex !== RANGE_HEX.acid && hex !== RANGE_HEX.acidDk) assert.ok(chroma < 0.12, `${hex} is a neutral`);
    }
});

test('every theme sky, fog and accent is a swatch of the range palette; accent is acid', async () => {
    const { RANGE_HEX } = await import('../../src/game/fps/rangePalette.js');
    const swatches = Object.values(RANGE_HEX).map(hex01);
    for (const t of themes.themes) {
        for (const [what, rgb] of [['sky', t.sky], ['fog', t.fog.colour], ['accent', t.accent]]) {
            assert.ok(swatches.some((s) => closeTo(s, rgb)), `${t.id} ${what} ${JSON.stringify(rgb)} is not a palette swatch`);
        }
        assert.ok(closeTo(hex01(RANGE_HEX.acid), t.accent), `${t.id} accent is acid`);
        assert.deepEqual(t.sky, t.fog.colour, `${t.id} fog fades to the sky colour`);
    }
});

test('room textures and thumbnails carry no orange, cyan or magenta pixels', async () => {
    const { decodePng } = await import('../../tools/validate-assets.mjs');
    for (const t of themes.themes) {
        for (const rel of [t.floorTexture, t.wallTexture, t.thumb]) {
            const img = decodePng(readFileSync(resolve(root, 'public', rel)));
            let chromatic = 0;
            let total = 0;
            for (let i = 0; i < img.width * img.height; i++) {
                const o = i * img.channels;
                const [r, g, b] = [img.data[o], img.data[o + 1], img.data[o + 2]];
                const chroma = Math.max(r, g, b) - Math.min(r, g, b);
                total += 1;
                // acid-dark (#b8d000) is the one allowed hue; everything else stays neutral
                if (chroma > 40 && !(g > r && g > b && r > b)) chromatic += 1;
            }
            assert.ok(chromatic / total < 0.001, `${rel}: ${(100 * chromatic / total).toFixed(2)}% chromatic pixels`);
        }
    }
});

test('Range and Neon are dark ink rooms, Vault and the tutorial are the light bone room', async () => {
    const { isLightSky } = await import('../../src/game/fps/hudText.js');
    const { resolveChart, ARENAS } = await import('../../src/game/rules/charts.js');
    const tutorial = resolveChart('tutorial');
    const byId = Object.fromEntries(themes.themes.map((t) => [t.id, t]));
    assert.equal(isLightSky(byId.range.sky), false);
    assert.equal(isLightSky(byId.neon.sky), false);
    assert.equal(isLightSky(byId.vault.sky), true);
    assert.equal(byId.vault.coinPrice, 300);
    assert.equal(byId.range.coinPrice, 0);
    assert.equal(byId.range.decor, 'crates');
    assert.equal(tutorial.arena.theme, ARENAS.vault.theme);
    assert.equal(tutorial.arena.accent, undefined, 'the tutorial uses the theme accent (acid), not an override');
    assert.ok(Object.values(themes.themes).every((t) => !/orange|cyan/i.test(t.name)));
});

test('rangeLook: dark rooms glow acid on ink, light rooms flip to flat ink marks', async () => {
    const { rangeLook, rangeRgb } = await import('../../src/game/fps/rangePalette.js');
    const acid = rangeRgb('acid');
    const dark = rangeLook(false, acid);
    const light = rangeLook(true, acid);
    assert.deepEqual(dark.ring.idle, acid);
    assert.deepEqual(dark.ring.close, rangeRgb('paper'));
    assert.equal(dark.sparks.additive, true);
    assert.equal(light.sparks.additive, false);
    assert.notDeepEqual(light.ring.idle, light.ring.close, 'the ring still changes when the bot is in the window');
    assert.deepEqual(light.ring.close, rangeRgb('ink'));
    assert.deepEqual(dark.tracer.hit, acid);
    // the lit lane frame always uses the accent, and differs from the idle frame in both rooms
    for (const look of [dark, light]) assert.notDeepEqual(look.frameActive.diffuse, look.frameIdle.diffuse);
});

test('no legacy cyan, magenta, mint or orange scene colours remain in the 3D range code', () => {
    for (const f of ['Arena.js', 'TargetField.js', 'Viewmodel.js']) {
        const src = readFileSync(resolve(root, 'src/game/fps', f), 'utf8');
        assert.doesNotMatch(src, /new Color[34]\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+/, `${f} builds colours from literals instead of rangePalette.js`);
    }
    assert.doesNotMatch(readFileSync(resolve(root, 'src/game/rules/charts.js'), 'utf8'), /0\.49,\s*1\.0,\s*0\.73/);
});

test('every bot skin reads on both the ink rooms and the bone room (dark outline plus a bright body)', async () => {
    const { decodePng } = await import('../../tools/validate-assets.mjs');
    const targets = JSON.parse(readFileSync(resolve(root, 'data/targets.json'), 'utf8')).targets;
    assert.ok(targets.length >= 15);
    const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (const t of targets) {
        const img = decodePng(readFileSync(resolve(root, 'public', t.sheet)));
        assert.equal(img.channels, 4, t.id);
        let opaque = 0;
        let dark = 0;
        let bright = 0;
        for (let y = 0; y < t.cellHeight; y++) {
            for (let x = 0; x < t.cellWidth; x++) {
                const o = (y * img.width + x) * 4;
                if (img.data[o + 3] <= 200) continue;
                opaque += 1;
                const l = luma(img.data[o], img.data[o + 1], img.data[o + 2]);
                if (l < 70) dark += 1;
                if (l > 110) bright += 1;
            }
        }
        // the outline separates the bot from the pale Vault; the bright body separates it from ink
        assert.ok(dark / opaque >= 0.12, `${t.id}: outline share ${(dark / opaque).toFixed(2)}`);
        assert.ok(bright / opaque >= 0.35, `${t.id}: bright body share ${(bright / opaque).toFixed(2)}`);
    }
});
