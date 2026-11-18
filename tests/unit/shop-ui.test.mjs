// AC39 / AC40: the Shop's view model, preview helpers, the results coin breakdown and the manifests behind them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';
import { buildCatalogue } from '../../src/game/progress/shopCatalog.js';
import { emptyWallet, earn, purchase } from '../../src/game/progress/wallet.js';
import { indexCatalogue } from '../../src/game/progress/shopCatalog.js';
import { buildShopView, statusMessage, actionFor, equipSettingsPatch, coinLabel } from '../../src/ui/shopModel.js';
import {
    botFrame, framePosition, crosshairSvg, CROSSHAIR_SHAPES, themeSwatches, BOT_FRAMES, IDLE_FRAME_MS,
} from '../../src/ui/shopPreview.js';
import { parseAtlasParams, parseAtlasShop, ATLAS_SCENES } from '../../src/game/atlasParams.js';
import { MENU_ENTRIES } from '../../src/ui/menuConfig.js';

register('../helpers/babylon-hooks.mjs', import.meta.url);
globalThis.window = globalThis;

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const manifests = { targets: load('targets.json'), crosshairs: load('crosshairs.json'), themes: load('themes.json') };
const catalogue = buildCatalogue(manifests, load('rules.json').economy);
const byId = indexCatalogue(catalogue);
const progress = (wallet, equipped = {}) => ({ wallet, equipped });

test('shop view: tabs count what is owned, and badges follow ownership and the equipped id', () => {
    const wallet = purchase(earn(emptyWallet(), 900), byId.get('woofer-boombox'), byId).wallet;
    const view = buildShopView(catalogue, progress(wallet, { targetSkin: 'woofer-boombox' }), { tab: 'bot' });
    assert.deepEqual(view.tabs.map((t) => t.id), ['bot', 'skin', 'crosshair', 'theme']);
    assert.equal(view.coins, 500);
    assert.equal(view.tabs[0].owned, 2, 'PULSE (free) and the bought WOOFER');
    const row = (id) => view.items.find((i) => i.id === id);
    assert.equal(row('woofer-boombox').badge, 'EQUIPPED');
    assert.equal(row('pulse-range-issue').badge, 'OWNED');
    assert.equal(row('iris-watcher').badge, '');
    assert.equal(row('iris-watcher').priceText, '400 coins');
    assert.equal(view.selected.id, 'woofer-boombox', 'the equipped item is selected by default');
});

test('shop view: with nothing equipped the free default bot and crosshair show as equipped, a theme does not', () => {
    const bots = buildShopView(catalogue, progress(emptyWallet()), { tab: 'bot' });
    assert.equal(bots.items.find((i) => i.id === 'pulse-range-issue').badge, 'EQUIPPED');
    assert.equal(buildShopView(catalogue, progress(emptyWallet()), { tab: 'crosshair' }).items[0].badge, 'EQUIPPED');
    assert.ok(buildShopView(catalogue, progress(emptyWallet()), { tab: 'theme' }).items.every((i) => !i.equipped));
    // An equipped item that is not owned (a synced setting) falls back to the default.
    const stale = buildShopView(catalogue, progress(emptyWallet(), { targetSkin: 'iris-watcher' }), { tab: 'bot' });
    assert.equal(stale.items.find((i) => i.id === 'iris-watcher').equipped, false);
    assert.equal(stale.items.find((i) => i.id === 'pulse-range-issue').equipped, true);
});

test('shop view: skins of a bot you lack are LOCKED, and an unknown tab falls back to the first', () => {
    const view = buildShopView(catalogue, progress(earn(emptyWallet(), 1000)), { tab: 'skin' });
    assert.equal(view.items.find((i) => i.id === 'iris-ember').badge, 'LOCKED');
    assert.equal(view.items.find((i) => i.id === 'pulse-arctic').badge, '');
    assert.equal(buildShopView(catalogue, progress(emptyWallet()), { tab: 'nope' }).tab, 'bot');
    assert.equal(buildShopView(catalogue, progress(emptyWallet()), { tab: 'theme', selectedId: 'vault' }).selected.id, 'vault');
});

test('actions: buy with the price, equip when owned, a disabled Equipped when already on', () => {
    const view = buildShopView(catalogue, progress(earn(emptyWallet(), 10), { theme: 'neon' }), { tab: 'theme', selectedId: 'vault' });
    assert.deepEqual(view.selected.action, { kind: 'buy', label: 'Buy · 300 coins' });
    const neon = buildShopView(catalogue, progress(emptyWallet(), { theme: 'neon' }), { tab: 'theme', selectedId: 'neon' }).selected;
    assert.equal(neon.action.kind, 'equipped');
    assert.equal(neon.action.disabled, true);
    assert.equal(actionFor({ owned: true, equipped: false }).kind, 'equip');
});

test('messages: a clear reason when the balance does not allow, a confirm prompt when it does', () => {
    const vault = byId.get('vault');
    assert.match(statusMessage({ state: 'poor', missing: 290 }, vault), /Not enough coins.*300 coins.*290 coins more/);
    assert.match(statusMessage({ state: 'ready' }, vault), /Buy Vault for 300 coins\?/);
    assert.match(statusMessage({ state: 'locked', requires: byId.get('iris-watcher') }, byId.get('iris-ember')), /Buy the IRIS Watcher bot first/);
    assert.equal(coinLabel(1), '1 coin');
    assert.equal(coinLabel(1200), '1,200 coins');
});

test('equipping changes the right settings: a bot sets the skin, a crosshair its colour and shape, a theme none', () => {
    assert.deepEqual(equipSettingsPatch(byId.get('iris-watcher'), 6), { targetSkin: 'iris-watcher' });
    assert.deepEqual(equipSettingsPatch(byId.get('xh-dot'), 6), { crosshairColour: '#ffffff', crosshairDot: true, crosshairLength: 0 });
    const ring = equipSettingsPatch(byId.get('xh-ring'), 3);
    assert.equal(ring.crosshairDot, false);
    assert.equal(ring.crosshairLength, 6);
    assert.equal(equipSettingsPatch(byId.get('vault'), 6), null);
});

test('bot preview: idle loops 0-3, hit plays 4-5 then returns, death holds its last frame', () => {
    const idle = (t) => botFrame({ mode: 'idle', since: 0 }, t).frame;
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => idle(i * IDLE_FRAME_MS)), [0, 1, 2, 3, 0]);
    assert.equal(botFrame({ mode: 'hit', since: 100 }, 100).frame, BOT_FRAMES.hit[0]);
    assert.equal(botFrame({ mode: 'hit', since: 0 }, 100).frame, BOT_FRAMES.hit[1]);
    assert.deepEqual(botFrame({ mode: 'hit', since: 0 }, 5000), { frame: 0, mode: 'idle' });
    assert.equal(botFrame({ mode: 'death', since: 0 }, 0).frame, BOT_FRAMES.death[0]);
    assert.equal(botFrame({ mode: 'death', since: 0 }, 9999).frame, BOT_FRAMES.death[1]);
    assert.deepEqual(framePosition(7, 96, 128, 3), { x: -2 * 288, y: -384 });
});

test('previews: every crosshair shape in the manifest draws, and themes give swatches', () => {
    for (const entry of manifests.crosshairs.crosshairs) {
        assert.ok(CROSSHAIR_SHAPES.includes(entry.shape), entry.shape);
        const svg = crosshairSvg(entry.shape, entry.colour);
        assert.match(svg, /^<svg /);
        assert.ok(svg.includes(entry.colour), entry.id);
    }
    assert.doesNotMatch(crosshairSvg('dot', '"><script>'), /script/, 'a bad colour never reaches the markup');
    for (const theme of manifests.themes.themes) {
        assert.ok(themeSwatches(theme).length >= 2, theme.id);
        assert.ok(existsSync(new URL(`../../public/${theme.thumb}`, import.meta.url)), theme.thumb);
    }
});

test('manifests: every cosmetic has a coinPrice, free items are exactly the defaults', () => {
    for (const e of [...manifests.crosshairs.crosshairs, ...manifests.themes.themes, ...manifests.targets.targets]) {
        assert.equal(typeof e.coinPrice, 'number', e.id);
    }
    const free = catalogue.filter((i) => i.price === 0).map((i) => i.id).sort();
    assert.deepEqual(free, ['neon', 'pulse-range-issue', 'range', 'xh-cross', 'xh-dot']);
});

test('menu and atlas: the Shop is a menu entry and ?atlas_scene=shop is a known scene', () => {
    assert.ok(MENU_ENTRIES.some((e) => e.id === 'shop' && e.label === 'Shop'));
    assert.ok(ATLAS_SCENES.includes('shop'));
    assert.equal(parseAtlasParams('?atlas_scene=shop').scene, 'shop');
    assert.deepEqual(parseAtlasShop('?atlas_tab=crosshair&atlas_item=xh-ring'), { tab: 'crosshair', selectedId: 'xh-ring' });
    assert.deepEqual(parseAtlasShop('?atlas_tab=evil&atlas_item=a b'), {});
});

test('results: a cleared level shows +N coins with its breakdown; Practice and tutorial show none', async () => {
    const { ResultScreen } = await import('../../src/game/screens/ResultScreen.js');
    const { ProgressStore } = await import('../../src/game/progress/store.js');
    const { memoryStorage } = await import('../../src/game/atlasHook.js');
    const record = {
        chartId: 't:neon:normal', difficulty: 'normal', rank: 'S', accuracy: 1, score: 1000, completed: true, passed: true,
        perfect: 10, good: 0, loose: 0, missed: 0, bestCombo: 10, counterStrafes: 10, notes: 10,
    };
    const stopQuality = { stopShots: 10, stopGood: 10 };
    const make = (options, chartId = 't:neon:normal') => {
        const store = new ProgressStore(memoryStorage(), { catalogue });
        const screen = new ResultScreen({ resultOverlay: {}, services: { progress: store } }, record, chartId, {}, { stopQuality, ...options });
        return { store, screen };
    };
    const real = make({ runMode: 'campaign' });
    real.screen.recordStars();
    // Clear 30 + rank S 30 + 3 new stars 75 + first clear 50.
    assert.equal(real.screen.coinAward.total, 185);
    assert.deepEqual(real.screen.coinAward.lines.map((l) => l.id), ['clear', 'rank', 'stars', 'first']);
    assert.equal(real.screen.coinAward.balance, 185);
    assert.equal(real.store.coins, 185);
    real.screen.recordStars();
    assert.equal(real.screen.coinAward.total, 60, 'replaying the same level pays the clear and rank only');

    for (const options of [{ runMode: 'practice', speed: 0.75 }, { runMode: 'quickPlay', replay: true }, { runMode: 'quickPlay', speed: 0.75 }]) {
        const { store, screen } = make(options);
        screen.recordStars();
        assert.equal(screen.coinAward, null, JSON.stringify(options));
        assert.equal(store.coins, 0);
    }
    const tutorial = make({ runMode: 'tutorial' }, 'tutorial');
    tutorial.screen.recordStars();
    assert.equal(tutorial.screen.coinAward, null);
    assert.equal(tutorial.store.coins, 0);
});

test('results markup and styles carry the coin block and the Shop dialog', () => {
    const html = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
    for (const id of ['resultCoins', 'resultCoinsTotal', 'resultCoinsBalance', 'resultCoinsLines']) assert.match(html, new RegExp(`id="${id}"`));
    const css = readFileSync(new URL('../../src/styles/game.css', import.meta.url), 'utf8');
    for (const cls of ['.shop__card', '.shop__tabs', '.shop__item', '.shop__sprite', '.shop__wallet', '.result__coins']) assert.ok(css.includes(cls), cls);
    const focus = readFileSync(new URL('../../src/input/menuFocus.js', import.meta.url), 'utf8');
    assert.match(focus, /shop-close/, 'the pad back button closes the Shop');
});
