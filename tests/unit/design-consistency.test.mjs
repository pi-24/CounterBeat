import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanCss, scanHtmlInline, scanJs, checkTokensLinked, checkRepo } from '../../tools/check-design-consistency.mjs';

test('the repo passes the design consistency check', () => {
    assert.deepEqual(checkRepo(), []);
});

test('CSS: raw hex, rgb and named colours are flagged, tokens are not', () => {
    assert.equal(scanCss('.a { color: #fff; }').length, 1);
    assert.equal(scanCss('.a { background: rgba(0, 0, 0, .5); }').length, 1);
    assert.equal(scanCss('.a { border: 1px solid red; }').length, 1);
    assert.equal(scanCss('.a { --mine: #123456; }').length, 1);
    assert.equal(scanCss('.a { color: var(--paper); background: color-mix(in srgb, var(--acid) 20%, transparent); white-space: nowrap; }').length, 0);
    assert.equal(scanCss('/* #fff red */ a:hover { color: var(--acid); }').length, 0);
    assert.equal(scanCss('#abc:hover { color: var(--acid); }').length, 0, 'an id selector is not a colour');
});

test('CSS: only the token font variables are allowed', () => {
    assert.equal(scanCss('.a { font-family: Arial, sans-serif; }').length, 1);
    assert.equal(scanCss('.a { font-family: "Anton"; }').length, 1);
    assert.equal(scanCss('.a { font-family: var(--font-body); }').length, 1, 'old alias is gone');
    assert.equal(scanCss('.a { font: 12px Arial; }').length, 1);
    for (const v of ['var(--display)', 'var(--body)', 'var(--mono)', 'inherit']) assert.equal(scanCss(`.a { font-family: ${v}; }`).length, 0, v);
    assert.equal(scanCss('.a { font: inherit; font: 800 13px var(--body); }').length, 0);
});

test('HTML: inline style, <style> and svg colour attributes are flagged', () => {
    assert.equal(scanHtmlInline('<div style="color:#fff"></div>').length, 1);
    assert.equal(scanHtmlInline('<div style="color:var(--acid)"></div>').length, 0);
    assert.equal(scanHtmlInline('<style>.a{font-family:Arial}</style>').length, 1);
    assert.equal(scanHtmlInline('<line stroke="#e2ff1f"></line>').length, 1);
    assert.equal(scanHtmlInline('<line stroke="currentColor"></line><p>&#9654;</p>').length, 0);
    assert.equal(scanHtmlInline('<!-- <i style="color:red"></i> -->').length, 0);
});

test('JS: colour literals and font families in script are flagged, comments and tokens are not', () => {
    assert.equal(scanJs("el.style.color = '#ff0000';").length >= 1, true);
    assert.equal(scanJs("const c = 'rgb(1 2 3)';").length, 1);
    assert.equal(scanJs("el.style.fontFamily = 'Arial';").length, 1);
    assert.equal(scanJs("el.style.color = 'var(--acid)';").length, 0);
    assert.equal(scanJs("// #e2ff1f in a comment\nconst a = 1;").length, 0);
    assert.equal(scanJs("document.querySelector('#add');").length, 0);
    assert.equal(scanJs('const css = `rgb(${r} ${g} ${b})`;').length, 0, 'computed colours from data are not literals');
});

test('every html page loads tokens.css before base.css', () => {
    assert.deepEqual(checkTokensLinked('<link rel="stylesheet" href="/src/styles/tokens.css"><link rel="stylesheet" href="/src/styles/base.css">'), []);
    assert.deepEqual(checkTokensLinked('<link rel="stylesheet" href="/src/styles/base.css">'), ['does not load tokens.css']);
    assert.deepEqual(checkTokensLinked('<link href="/src/styles/base.css"><link href="/src/styles/tokens.css">'), ['loads base.css before tokens.css']);
});
