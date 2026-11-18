/**
 * check-design-consistency.mjs - keeps the whole game on one design system (direction C, tokens.css).
 *
 * Fails when:
 *   1. any CSS rule, inline `style=` / `<style>` or JS style string in src/ or the html pages uses a
 *      hex / rgb() / hsl() / named colour outside src/styles/tokens.css,
 *   2. any `font-family` (or `font:` shorthand) is not one of the token font variables
 *      var(--display) / var(--body) / var(--mono),
 *   3. an html page does not load tokens.css (and load it before base.css).
 *
 * Exempt (documented, not UI styling): the 3D scene/engine constants in src/game/fps, the data-default
 * colour in src/game/rules/config.js, and the JS mirror of the tokens in src/ui/palette.js (which
 * tests/unit/palette-tokens.test.mjs keeps equal to tokens.css).
 *
 *   node tools/check-design-consistency.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TOKENS_CSS = 'src/styles/tokens.css';
export const ALLOWED_FONT_VARS = Object.freeze(['--display', '--body', '--mono']);
export const EXEMPT_PREFIXES = Object.freeze([
    'src/game/fps/', // 3D scene / engine colour constants
    'src/game/rules/config.js', // shared rules data default
    'src/ui/palette.js', // JS mirror of the tokens (palette-tokens.test.mjs)
    TOKENS_CSS,
]);

const NAMED_COLOURS = [
    'white', 'black', 'red', 'green', 'blue', 'yellow', 'orange', 'cyan', 'magenta', 'purple', 'pink', 'gray', 'grey',
    'silver', 'gold', 'lime', 'teal', 'navy', 'maroon', 'olive', 'aqua', 'fuchsia', 'brown', 'crimson', 'tomato',
];
const NAMED_RE = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.join('|')})(?![\\w-])`, 'i');
const FN_COLOUR_RE = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.+-]/i;
const HEX_RE = /(?<![\w&#-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const HEX_LONG_RE = /(?<![\w&#-])#(?:[0-9a-f]{8}|[0-9a-f]{6})(?![\w-])/i;
/** properties whose value may legitimately hold a word like `white` (white-space) never reach NAMED_RE: it is only run on colour properties */
const COLOUR_PROP_RE = /(^|-)(color|background|border|outline|fill|stroke|shadow|filter|caret-color|accent-color|box-shadow|text-shadow|column-rule)(-|$)|^(background|border|outline|fill|stroke|filter|box-shadow|text-shadow)$/i;

/** @param {string} css @returns {string} */
export function stripCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function lineOf(text, index) {
    let n = 1;
    for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
}

/**
 * Checks one declaration. Returns problem strings.
 * @param {string} prop
 * @param {string} value
 */
export function checkDeclaration(prop, value) {
    const out = [];
    const p = prop.trim().toLowerCase();
    const v = value.trim();
    if (p.startsWith('--')) {
        // custom property definitions: any raw colour belongs in tokens.css
        if (HEX_RE.test(v) || FN_COLOUR_RE.test(v)) out.push(`custom property ${p} defines a raw colour (${v}); define it in tokens.css`);
        return out;
    }
    if (HEX_RE.test(v)) out.push(`hex colour in ${p}: ${v}`);
    if (FN_COLOUR_RE.test(v)) out.push(`rgb/hsl colour in ${p}: ${v}`);
    if (COLOUR_PROP_RE.test(p) && NAMED_RE.test(v.replace(/url\([^)]*\)/gi, ''))) out.push(`named colour in ${p}: ${v}`);
    if (p === 'font-family') {
        const parts = v.split(',').map((s) => s.trim());
        const ok = /^(inherit|initial|unset)$/i.test(v) || (parts.length === 1 && ALLOWED_FONT_VARS.some((n) => v === `var(${n})`));
        if (!ok) out.push(`font-family must be var(--display|--body|--mono), got: ${v}`);
    } else if (p === 'font') {
        const ok = /^(inherit|initial|unset)$/i.test(v) || ALLOWED_FONT_VARS.some((n) => v.includes(`var(${n})`));
        if (!ok) out.push(`font shorthand must be inherit or use a token font variable, got: ${v}`);
    }
    return out;
}

/**
 * @param {string} css
 * @returns {{line:number, message:string}[]}
 */
export function scanCss(css) {
    const clean = stripCssComments(css);
    const found = [];
    const re = /([\w-]+)\s*:\s*([^;{}]+)/g;
    let m;
    while ((m = re.exec(clean))) {
        // skip selectors such as `a:hover` (a `{` follows before any `;`) - the value regex stops at `{`
        const after = clean[re.lastIndex];
        if (after === '{') continue;
        for (const message of checkDeclaration(m[1], m[2])) found.push({ line: lineOf(clean, m.index), message });
    }
    return found;
}

/**
 * @param {string} html
 * @returns {{line:number, message:string}[]}
 */
export function scanHtmlInline(html) {
    const clean = html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
    const found = [];
    for (const m of clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
        const base = lineOf(clean, m.index);
        for (const f of scanCss(m[1])) found.push({ line: base + f.line - 1, message: `<style>: ${f.message}` });
    }
    for (const m of clean.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
        for (const f of scanCss(m[2] ?? m[3] ?? '')) found.push({ line: lineOf(clean, m.index), message: `style attribute: ${f.message}` });
    }
    // presentation attributes (SVG): stroke="#hex", fill="rgb(...)", color="red" ...
    for (const m of clean.matchAll(/\s(fill|stroke|color|stop-color|flood-color|bgcolor)\s*=\s*"([^"]*)"/gi)) {
        const v = m[2].trim();
        if (HEX_RE.test(v) || FN_COLOUR_RE.test(v) || NAMED_RE.test(v)) {
            found.push({ line: lineOf(clean, m.index), message: `${m[1]} attribute uses a raw colour (${v}); use currentColor and a token in CSS` });
        }
    }
    return found;
}

/**
 * JS: only strings that carry styling. A raw 6/8-digit hex, an rgb()/hsl() literal with numbers, or a
 * font-family / style assignment with a literal.
 * @param {string} js
 * @returns {{line:number, message:string}[]}
 */
export function scanJs(js) {
    const clean = js
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    const found = [];
    const lines = clean.split('\n');
    lines.forEach((text, i) => {
        if (HEX_LONG_RE.test(text)) found.push({ line: i + 1, message: `hex colour literal in script: ${text.trim()}` });
        else if (FN_COLOUR_RE.test(text)) found.push({ line: i + 1, message: `rgb/hsl colour literal in script: ${text.trim()}` });
        if (/\bfontFamily\b|font-family\s*:/.test(text) && !/var\(--(display|body|mono)\)/.test(text)) {
            found.push({ line: i + 1, message: `font family set in script without a token variable: ${text.trim()}` });
        }
        for (const m of text.matchAll(/style\.(?:color|background(?:Color)?|borderColor|outlineColor|fill|stroke)\s*=\s*['"`]([^'"`]*)['"`]/g)) {
            if (!/^var\(--[\w-]+\)$/.test(m[1])) found.push({ line: i + 1, message: `inline style colour must be a var(--token): ${text.trim()}` });
        }
    });
    return found;
}

/**
 * Html page must link tokens.css, before base.css.
 * @param {string} html
 * @returns {string[]}
 */
export function checkTokensLinked(html) {
    const hrefs = [...html.matchAll(/<link\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
    const t = hrefs.findIndex((h) => /(^|\/)tokens\.css(\?|$)/.test(h));
    if (t === -1) return ['does not load tokens.css'];
    const b = hrefs.findIndex((h) => /(^|\/)base\.css(\?|$)/.test(h));
    return b !== -1 && b < t ? ['loads base.css before tokens.css'] : [];
}

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const exempt = (r) => EXEMPT_PREFIXES.some((p) => r === p || r.startsWith(p));

/** @param {string} root @returns {string[]} problem lines (empty when consistent) */
export function checkRepo(root = ROOT) {
    const problems = [];
    const srcFiles = walk(path.join(root, 'src'));
    const htmlFiles = [
        ...readdirSync(root).filter((n) => n.endsWith('.html')).map((n) => path.join(root, n)),
        ...srcFiles.filter((f) => f.endsWith('.html')),
    ];
    const add = (r, list) => list.forEach((p) => problems.push(`${r}${p.line ? `:${p.line}` : ''}: ${p.message ?? p}`));

    for (const file of srcFiles) {
        const r = path.relative(root, file).split(path.sep).join('/');
        if (exempt(r)) continue;
        if (file.endsWith('.css')) add(r, scanCss(readFileSync(file, 'utf8')));
        else if (file.endsWith('.js') || file.endsWith('.mjs')) add(r, scanJs(readFileSync(file, 'utf8')));
    }
    for (const file of htmlFiles) {
        const r = path.relative(root, file).split(path.sep).join('/');
        const text = readFileSync(file, 'utf8');
        add(r, scanHtmlInline(text));
        for (const p of checkTokensLinked(text)) problems.push(`${r}: ${p}`);
    }
    return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const problems = checkRepo();
    if (problems.length) {
        console.error(`design consistency: ${problems.length} problem(s)`);
        for (const p of problems) console.error(`  ${p}`);
        process.exit(1);
    }
    console.log('design consistency: OK (every colour from tokens.css, every font a token variable, every page loads tokens.css)');
}
