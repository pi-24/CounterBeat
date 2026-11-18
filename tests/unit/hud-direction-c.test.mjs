// T26: Direction C HUD, results and leaderboard view models; markup carries every hook the code uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    botCounter, progressSegments, multiplierLabel, headLabel, paceLabel, stopMeterLayout, meterMarkerX,
    stopReadout, formatTimingMs, judgementPlate, pushRecent, hudDetail, meterRange,
} from '../../src/game/fps/hudText.js';
import { SPEED_GRADE } from '../../src/game/rules/config.js';
import { STOP_SPEED } from '../../src/game/rules/rules.js';
import {
    timingSd, meanSdText, meanMarkerPercent, personalBestText, judgementCells, starGlyphs,
} from '../../src/ui/Results.js';
import { timingHistogram } from '../../src/game/stats/histogram.js';
import { buildBoardView, percentText } from '../../src/ui/leaderboardModel.js';

const html = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
const hudSource = readFileSync(new URL('../../src/game/fps/Hud.js', import.meta.url), 'utf8');

test('the stop meter zones sit at the locked 20 / 65 / 140 u/s thresholds, to scale and centred', () => {
    assert.deepEqual([STOP_SPEED.perfect, STOP_SPEED.good, STOP_SPEED.loose], [20, 65, 140]);
    const layout = stopMeterLayout(SPEED_GRADE, 600);
    assert.equal(layout.perUnit * layout.range * 2, 600);
    for (const [zone, speed] of [['perfect', 20], ['good', 65], ['loose', 140]]) {
        assert.ok(Math.abs(layout[zone].width - speed * 2 * layout.perUnit) < 1e-9, zone);
        assert.ok(Math.abs(layout[zone].x + layout[zone].width / 2 - 300) < 1e-9, `${zone} centred`);
    }
    assert.ok(layout.loose.width > layout.good.width && layout.good.width > layout.perfect.width);
});

test('the meter marker follows signed speed and clamps at the bar edges', () => {
    assert.equal(meterMarkerX(0, SPEED_GRADE), 300);
    assert.ok(meterMarkerX(100, SPEED_GRADE) > 300);
    assert.ok(meterMarkerX(-100, SPEED_GRADE) < 300);
    assert.equal(meterMarkerX(99999, SPEED_GRADE), 600);
    assert.equal(meterMarkerX(-99999, SPEED_GRADE), 0);
    assert.equal(meterRange(SPEED_GRADE), 200);
    assert.equal(stopReadout(12.4), '+12 u/s');
    assert.equal(stopReadout(-40), '−40 u/s');
    assert.equal(stopReadout(0.2), '0 u/s');
});

test('judgement plate: signed milliseconds, HEAD chip only on hits', () => {
    assert.equal(formatTimingMs(-0.008), '−8ms');
    assert.equal(formatTimingMs(0.0124), '+12ms');
    assert.equal(formatTimingMs(0), '0ms');
    assert.equal(formatTimingMs(undefined), '');
    const hit = judgementPlate({ grade: 'perfect', label: 'PERFECT', timingError: -0.008, headshot: true });
    assert.deepEqual([hit.label, hit.ms, hit.head], ['PERFECT', '−8ms', true]);
    const miss = judgementPlate({ grade: 'miss', label: 'MISS', timingError: 0.2, headshot: true });
    assert.deepEqual([miss.ms, miss.head], ['', false]);
    const wild = judgementPlate({ grade: 'wild', label: 'WILD SHOT', reason: 'No bot on that beat' });
    assert.equal(wild.reason, 'No bot on that beat');
});

test('corner block strings', () => {
    assert.deepEqual(botCounter(14, 32), { current: '14', total: '/ 32' });
    assert.deepEqual(progressSegments(16, 32), { count: 32, done: 16 });
    assert.deepEqual(progressSegments(5, 200), { count: 32, done: 0 });
    assert.deepEqual(progressSegments(0, 0), { count: 0, done: 0 });
    assert.equal(multiplierLabel(4), '×4');
    assert.equal(multiplierLabel(1.5), '×1.5');
    assert.equal(headLabel(9, 13), '9/13');
    assert.equal(paceLabel('S', 3), 'S');
    assert.equal(paceLabel('S', 0), '–');
    assert.deepEqual(pushRecent(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'i'), ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    assert.equal(hudDetail({ name: 'Neon Alley · Hard', difficulty: { name: 'Hard' } }, true, true), 'Hard · REPLAY · PLACEHOLDER MUSIC');
    assert.equal(hudDetail({ name: 'Tutorial', difficulty: { name: 'Tutorial' } }), '');
});

test('every HUD id the code reads exists in game.html', () => {
    const wanted = new Set([...hudSource.matchAll(/this\.find\('([A-Za-z]+)'\)/g)].map((m) => m[1]));
    assert.ok(wanted.size > 20);
    for (const id of wanted) {
        assert.ok(html.includes(`id="${id}"`), `#${id} missing from game.html`);
    }
});

test('timing stats: mean, spread and the histogram mean marker', () => {
    assert.equal(timingSd([5]), 0);
    assert.equal(Math.round(timingSd([-10, 10])), 10);
    assert.equal(meanSdText([]), '');
    assert.equal(meanSdText([-14, -2, -2, 6]), 'MEAN −3ms · SD 7ms');
    assert.equal(meanSdText([10, 20]), 'MEAN +15ms · SD 5ms');
    assert.equal(meanMarkerPercent(timingHistogram([0, 0])), 50);
    assert.ok(meanMarkerPercent(timingHistogram([-50, -50])) < 50);
    assert.ok(meanMarkerPercent(timingHistogram([50])) > 50);
});

test('personal best line, judgement cells and star glyphs', () => {
    assert.equal(personalBestText(381940, 412880), '+30,940 PERSONAL BEST');
    assert.equal(personalBestText(0, 5000), 'FIRST SCORE ON THIS CHART');
    assert.equal(personalBestText(9000, 5000), '');
    const cells = judgementCells({ perfect: 24, good: 6, loose: 1, missed: 1 });
    assert.deepEqual(cells.map((c) => [c.key, c.value]), [['perfect', 24], ['good', 6], ['loose', 1], ['miss', 1]]);
    assert.equal(starGlyphs([true, true, false]), '★★☆');
});

test('leaderboard view: ranks by score, pins your row with neighbours, marks the podium', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
        userId: `u${i}`, displayName: `p${i}`, score: 1000 - i, accuracy: 0.9, bestCombo: 10, runId: `r${i}`, hasReplay: i % 2 === 0,
    }));
    const view = buildBoardView(rows, { userId: 'u11' });
    assert.equal(view.total, 20);
    assert.equal(view.me.pos, 12);
    assert.deepEqual(view.entries.filter((e) => !e.gap).map((e) => e.pos), [1, 2, 3, 4, 5, 11, 12, 13]);
    assert.equal(view.entries.filter((e) => e.gap).length, 1);
    assert.equal(view.entries.filter((e) => e.isMe).length, 1);
    assert.deepEqual(view.entries.filter((e) => e.top).map((e) => e.pos), [1, 2, 3]);
    assert.equal(view.topPercent, 'YOU: 12 OF 20');
    assert.equal(percentText(0.97184), '97.18%');
});

test('leaderboard view: no rows, or you are not on it, still renders cleanly', () => {
    assert.deepEqual(buildBoardView([]).entries, []);
    assert.equal(buildBoardView(undefined).total, 0);
    const view = buildBoardView([{ userId: 'a', displayName: 'a', score: 1, accuracy: 1, bestCombo: 1 }], { userId: 'zzz' });
    assert.equal(view.me, null);
    assert.equal(view.topPercent, '');
    assert.equal(view.entries.length, 1);
});

test('isLightSky: the pale Range sky gets the HUD scrim, the neon and vault skies do not', async () => {
    const { isLightSky } = await import('../../src/game/fps/hudText.js');
    const { default: themes } = await import('../../data/themes.json', { with: { type: 'json' } });
    const sky = (id) => themes.themes.find((t) => t.id === id)?.sky;
    assert.equal(isLightSky(sky('range')), true);
    for (const t of themes.themes.filter((x) => x.id !== 'range')) assert.equal(isLightSky(t.sky), false, t.id);
    assert.equal(isLightSky(undefined), false);
});

test('the stop meter is keyed on the thresholds, so an equal copy of the grades does not relayout', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../src/game/fps/Hud.js', import.meta.url), 'utf8');
    assert.match(src, /pinPoint\}\/\$\{grades\.tight\}\/\$\{grades\.loose\}/);
    assert.doesNotMatch(src, /typeof grades !== 'object'/);
});
