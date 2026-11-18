import test from 'node:test';
import assert from 'node:assert/strict';
import { trackLengthSec, formatLength, starGlyphs, stepIndex, initialSelection, buildSongRows, indexCounter } from '../../src/ui/songSelectModel.js';
import { RunHistory, betterRank, isRecordable } from '../../src/ui/runHistory.js';
import { coverSvg, COVER_IDS } from '../../src/ui/trackCovers.js';
import { buildMenuPreview, chipsModel, playerLevel, ago, percent } from '../../src/ui/menuPreview.js';
import { menuKeyEvent } from '../../src/input/menuKeys.js';
import { MENU_ENTRIES } from '../../src/ui/menuConfig.js';
import { TRACKS } from '../../src/game/rules/charts.js';

const memory = () => {
    const map = new Map();
    return { read: (k, d) => (map.has(k) ? structuredClone(map.get(k)) : d), write: (k, v) => map.set(k, structuredClone(v)) };
};

test('length and star formatting', () => {
    assert.equal(trackLengthSec({ bars: 32, bpm: 128 }), 60);
    assert.equal(formatLength(75), '1:15');
    assert.equal(formatLength(-3), '0:00');
    assert.equal(starGlyphs([true, false, true]), '★☆★');
    assert.equal(starGlyphs(null), '');
    assert.equal(indexCounter(2, 6), '03 / 06');
});

test('selection movement is clamped, never wraps', () => {
    assert.equal(stepIndex(0, -1, 6), 0);
    assert.equal(stepIndex(5, 1, 6), 5);
    assert.equal(stepIndex(2, 1, 6), 3);
});

test('initial selection resumes the last run, else the first playable track on Normal', () => {
    const rows = [{ id: 'a', playable: true }, { id: 'b', playable: true }, { id: 'c', playable: false }];
    const ids = ['easy', 'normal', 'hard', 'expert'];
    assert.deepEqual(initialSelection(rows, ids, { trackId: 'b', difficulty: 'hard' }), { track: 1, difficulty: 2 });
    assert.deepEqual(initialSelection(rows, ids, { trackId: 'c', difficulty: 'hard' }), { track: 0, difficulty: 1 });
    assert.deepEqual(initialSelection(rows, ids, null), { track: 0, difficulty: 1 });
    assert.deepEqual(initialSelection(rows, ids, { trackId: 'a', difficulty: 'nope' }), { track: 0, difficulty: 1 });
});

test('buildSongRows makes one row per real track with lock notes', () => {
    const states = Object.fromEntries(TRACKS.map((t, i) => [t.id, { gate: i * 3, unlocked: i === 0 }]));
    const rows = buildSongRows(TRACKS, states, { playable: (u) => u, stars: 1, placeholder: () => true });
    assert.equal(rows.length, TRACKS.length);
    assert.equal(rows[0].playable, true);
    assert.equal(rows[1].playable, false);
    assert.match(rows[1].lockNote, /Earn 3 stars.*you have 1/);
    assert.match(rows[0].length, /^\d+:\d\d$/);
});

test('every track has its own geometric cover, and unknown ids fall back safely', () => {
    for (const track of TRACKS) {
        assert.ok(COVER_IDS.includes(track.id), `cover for ${track.id}`);
        assert.match(coverSvg(track.id), /^<svg[^>]*viewBox="0 0 100 100"/);
    }
    assert.equal(new Set(TRACKS.map((t) => coverSvg(t.id))).size, TRACKS.length, 'covers are distinct');
    assert.match(coverSvg('<script>'), /cover--range/);
    assert.doesNotMatch(coverSvg('x'), /#[0-9a-f]{3,6}/i, 'no colour literals: palette classes only');
});

test('run history keeps best rank and accuracy per chart and the last session', () => {
    const h = new RunHistory(memory());
    assert.equal(h.last, null);
    assert.equal(h.bestRank(), null);
    assert.ok(h.record({ chartId: 'a:normal', trackId: 'a', trackName: 'A', difficulty: 'normal', score: 1000.4, accuracy: 0.8, rank: 'B' }, { mode: 'quickPlay', at: 5 }));
    assert.ok(h.record({ chartId: 'a:normal', score: 10, accuracy: 0.6, rank: 'A' }, { mode: 'campaign' }));
    h.record({ chartId: 'a:normal', score: 10, accuracy: 0.5, rank: 'D' });
    assert.equal(h.bestRankFor('a:normal'), 'A');
    assert.equal(h.bestAccuracyFor('a:normal'), 0.8);
    assert.equal(h.bestRank(), 'A');
    assert.equal(h.last.rank, 'D');
    assert.equal(h.bestAccuracy(), 0.8);
});

test('practice, tutorial and malformed runs are not recorded', () => {
    const h = new RunHistory(memory());
    assert.equal(h.record({ chartId: 'a', score: 1, accuracy: 1, rank: 'S' }, { mode: 'practice' }), false);
    assert.equal(h.record({ chartId: 'a', difficulty: 'tutorial', score: 1, accuracy: 1, rank: 'S' }), false);
    assert.equal(h.record({ score: 1 }), false);
    assert.equal(h.record(null), false);
    assert.equal(h.last, null);
    assert.equal(isRecordable({ mode: 'practice' }), false);
    assert.equal(betterRank('B', 'S'), 'S');
    assert.equal(betterRank(null, 'C'), 'C');
    assert.equal(betterRank(null, null), null);
});

test('corrupt stored history is ignored, not thrown on', () => {
    const storage = { read: () => ({ charts: { x: { rank: 'ZZ', accuracy: 9 } }, last: { chartId: 7 } }), write() {} };
    const h = new RunHistory(storage);
    assert.equal(h.last, null);
    assert.equal(h.bestRankFor('x'), null);
    assert.equal(h.bestAccuracyFor('x'), 1);
});

const ctx = (extra = {}) => ({
    stars: 6, starTotal: 54, tracksOpen: 2, trackCount: 6, nextGate: 8, bestRank: 'A', bestAccuracy: 0.912,
    last: null, lastRank: null, daily: null, dailyClock: '', songs: 2, loggedIn: false, desktop: true,
    focusTrackId: 'neon', settings: { sensitivity: 1, fov: 90, offsetMs: 12 }, now: 1_000_000, ...extra,
});

test('menu preview shows real data for every configured entry', () => {
    for (const entry of MENU_ENTRIES) {
        const model = buildMenuPreview(entry.id, ctx());
        assert.ok(model.title, `${entry.id} has a title`);
        assert.ok(Array.isArray(model.stats));
    }
    const campaign = buildMenuPreview('campaign', ctx());
    assert.deepEqual(campaign.stats[0], { label: 'STARS', value: '6/54' });
    assert.match(campaign.body, /2 more stars/);
    const last = { trackName: 'Neon Alley', trackId: 'neon', difficulty: 'hard', score: 12345, accuracy: 0.8771, at: 1_000_000 - 5 * 60000, rank: 'B' };
    const quick = buildMenuPreview('quickplay', ctx({ last, lastRank: 'A' }));
    assert.equal(quick.tag, 'LAST SESSION');
    assert.deepEqual(quick.stats.map((s) => s.value), ['12,345', 'A', '87.7%']);
    assert.match(quick.body, /5 min ago/);
    assert.equal(buildMenuPreview('ranked', ctx()).stats[0].value, 'A');
    assert.equal(buildMenuPreview('settings', ctx()).stats[2].value, '+12 MS');
    assert.match(buildMenuPreview('quit', ctx()).body, /Progress is already saved/);
    assert.match(buildMenuPreview('quit', ctx({ desktop: false })).body, /website/);
});

test('player chips and level', () => {
    assert.equal(playerLevel(0), 1);
    assert.equal(playerLevel(7), 3);
    assert.deepEqual(chipsModel({ name: 'ana', bestRank: null, stars: 3 }), [
        { label: 'PLAYER', value: 'ANA' }, { label: 'RANK', value: '-' }, { label: 'LEVEL', value: '2' },
    ]);
    assert.equal(chipsModel({ name: '', bestRank: 'S', stars: 0 })[0].value, 'GUEST');
    assert.equal(percent(0.5), '50.0%');
    assert.equal(ago(0, 30_000), 'just now');
    assert.equal(ago(0, 3 * 3600_000), '3 h ago');
    assert.equal(ago(0, 3 * 86400_000), '3 days ago');
});

test('keyboard maps to the same events as the pad', () => {
    assert.equal(menuKeyEvent('KeyQ'), 'prev');
    assert.equal(menuKeyEvent('KeyE'), 'next');
    assert.equal(menuKeyEvent('ArrowDown'), 'down');
    assert.equal(menuKeyEvent('Escape'), 'back');
    assert.equal(menuKeyEvent('KeyH'), 'help');
    assert.equal(menuKeyEvent('KeyZ'), null);
});
