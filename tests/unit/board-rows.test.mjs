import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    byScore, rankRows, sortRows, filterRows, boardEntries, SORT_COLUMNS,
} from '../../src/ui/boardRows.js';

const root = resolve(import.meta.dirname, '../..');
const ROWS = [
    { userId: 'a', displayName: 'Alpha', score: 900, accuracy: 0.91, bestCombo: 20, counterStrafes: 5, playedAt: '2026-01-02T00:00:00Z', runId: 'r1', hasReplay: true, levelName: 'Neon Alley · Hard' },
    { userId: 'b', displayName: 'beta', score: 1200, accuracy: 0.85, bestCombo: 31, counterStrafes: 9, playedAt: '2026-01-03T00:00:00Z', runId: null, hasReplay: false, levelName: 'Overclock · Hard' },
    { userId: 'c', displayName: 'Gamma', score: 900, accuracy: 0.97, bestCombo: 12, counterStrafes: 30, playedAt: '2026-01-01T00:00:00Z', runId: 'r3', hasReplay: true, levelName: 'The Range · Easy' },
    { userId: 'd', displayName: 'Delta', score: 100, accuracy: 0.5, bestCombo: 2, counterStrafes: 1, playedAt: 'bad date', runId: 'r4', hasReplay: false, levelName: 'x' },
];

test('rankRows orders by score then earliest run and stamps the place', () => {
    const ranked = rankRows(ROWS);
    assert.deepEqual(ranked.map((r) => r.displayName), ['beta', 'Gamma', 'Alpha', 'Delta']);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4]);
    assert.ok(byScore(ROWS[0], ROWS[2]) > 0, 'the earlier tie wins');
});

test('sorting by another column keeps each place number and breaks ties by rank', () => {
    const ranked = rankRows(ROWS);
    assert.deepEqual(sortRows(ranked, 'accuracy').map((r) => r.displayName), ['Gamma', 'Alpha', 'beta', 'Delta']);
    assert.deepEqual(sortRows(ranked, 'counterStrafes').map((r) => r.rank), [2, 1, 3, 4]);
    assert.deepEqual(sortRows(ranked, 'nonsense').map((r) => r.rank), [1, 2, 3, 4]);
});

test('filterRows is a case-insensitive name search', () => {
    const ranked = rankRows(ROWS);
    assert.deepEqual(filterRows(ranked, ' GAM ').map((r) => r.displayName), ['Gamma']);
    assert.equal(filterRows(ranked, '').length, 4);
    assert.equal(filterRows(ranked, 'zzz').length, 0);
});

test('boardEntries mirrors the results sheet: top three, own row, replay, sort column', () => {
    const entries = boardEntries(rankRows(ROWS), { currentUserId: 'a' });
    assert.deepEqual(entries.map((e) => e.isTop), [true, true, true, false]);
    assert.deepEqual(entries.map((e) => e.isMe), [false, false, true, false]);
    assert.equal(entries[0].score, '1,200');
    assert.equal(entries[0].accuracy, '85.0%');
    assert.equal(entries[0].stat, '31');
    assert.equal(entries[0].hasReplay, false);
    assert.equal(entries[1].hasReplay, true);
    assert.equal(entries[1].runId, 'r3');
    assert.equal(boardEntries(rankRows(ROWS), { sortKey: 'counterStrafes' })[1].stat, '30');
    assert.equal(SORT_COLUMNS.counterStrafes.label, 'CS');
    assert.ok(!entries.some((e) => e.isMe && e.name === 'beta'));
});

test('a signed-out viewer never matches a row', () => {
    assert.ok(boardEntries(rankRows(ROWS), { currentUserId: null }).every((e) => !e.isMe));
});

test('the chart name is only printed when the chart varies per row', () => {
    const best = boardEntries(rankRows(ROWS), { showChart: true });
    assert.match(best[0].detail, /Overclock/);
    assert.doesNotMatch(boardEntries(rankRows(ROWS))[0].detail, /Overclock/);
});

test('rankings.html reuses the results-screen sheet: same tabs, rows, replay and columns', () => {
    const html = readFileSync(resolve(root, 'rankings.html'), 'utf8');
    assert.match(html, /class="board__tab"/);
    assert.match(html, /board__meta/);
    assert.match(html, /board__foot/);
    assert.match(html, /id="levelFilter"[\s\S]*id="sortBy"[\s\S]*id="searchPlayer"/);
    assert.doesNotMatch(html, /<table/);
    const css = readFileSync(resolve(root, 'src/styles/components.css'), 'utf8');
    for (const sel of ['.board__row', '.board__row.is-me', '.board__row.is-top .pos', '.board__replay', '.board__tab.is-on::after']) {
        assert.ok(css.includes(sel), sel);
    }
    const game = readFileSync(resolve(root, 'src/styles/game.css'), 'utf8');
    assert.doesNotMatch(game, /^\.board__row\b/m, 'row styles live in the shared stylesheet, not twice');
});

test('every site page loads the shared C stylesheets and no old neon level thumbnails', () => {
    const pages = ['index', 'how-to-play', 'rankings', 'profile', 'login', 'register'];
    for (const p of pages) {
        const html = readFileSync(resolve(root, `${p}.html`), 'utf8');
        for (const css of ['tokens', 'base', 'layout', 'components', 'pages']) assert.ok(html.includes(`styles/${css}.css`), `${p}: ${css}`);
        assert.doesNotMatch(html, /images\/levels\//, p);
    }
});

test('site stylesheets use no gradients, glows or rounded corners (flat C look)', () => {
    for (const f of ['layout.css', 'components.css', 'pages.css']) {
        const css = readFileSync(resolve(root, 'src/styles', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(css, /gradient\(|backdrop-filter|drop-shadow|border-radius:\s*(?!0[;\s]|50%)[^\s;]/, f);
    }
    assert.ok(readdirSync(resolve(root, 'src/styles')).includes('pages.css'));
});
