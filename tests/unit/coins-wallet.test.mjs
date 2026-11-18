// AC39 / AC40: coins per level, the wallet, the migration from star unlocks and the Shop rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateAward, awardsCoins, coinsText } from '../../src/game/progress/coins.js';
import {
    emptyWallet, sanitiseWallet, balance, isOwned, earn, markCleared, buyStatus, purchase, mergeWallets, migrateLegacy,
} from '../../src/game/progress/wallet.js';
import { buildCatalogue, indexCatalogue, itemsOfKind } from '../../src/game/progress/shopCatalog.js';
import { ProgressStore } from '../../src/game/progress/store.js';
import { RULES } from '../../src/game/rules/rules.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const rulesJson = load('rules.json');
const catalogue = buildCatalogue({ targets: load('targets.json'), crosshairs: load('crosshairs.json'), themes: load('themes.json') }, rulesJson.economy);
const byId = indexCatalogue(catalogue);
const memory = () => {
    const data = new Map();
    return { read: (k, f) => (data.has(k) ? structuredClone(data.get(k)) : f), write: (k, v) => { data.set(k, structuredClone(v)); }, data };
};
const clear = (extra = {}) => ({ mode: 'campaign', kind: 'track', difficulty: 'normal', rank: 'B', newStars: 0, firstClear: false, ...extra });

test('economy block carries the starting values and the client copy matches rules.json', () => {
    assert.deepEqual(rulesJson.economy.difficultyMultiplier, { easy: 1, normal: 1.5, hard: 2, expert: 3 });
    assert.equal(rulesJson.economy.clearBase, 20);
    assert.deepEqual(rulesJson.economy.rankBonus, { S: 30, A: 20, B: 10 });
    assert.equal(rulesJson.economy.perNewStar, 25);
    assert.equal(rulesJson.economy.firstClear, 50);
    assert.deepEqual(rulesJson.economy.prices, { bot: 400, skin: 150, crosshair: 100, theme: 300 });
    assert.deepEqual(RULES.economy, rulesJson.economy);
});

test('award: clear x difficulty multiplier', () => {
    const base = (difficulty) => calculateAward(clear({ difficulty, rank: 'C' })).total;
    assert.equal(base('easy'), 20);
    assert.equal(base('normal'), 30);
    assert.equal(base('hard'), 40);
    assert.equal(base('expert'), 60);
});

test('award: rank, new-star and first-clear bonuses add up with a breakdown', () => {
    const award = calculateAward(clear({ difficulty: 'hard', rank: 'S', newStars: 2, firstClear: true }));
    assert.deepEqual(award.lines.map((l) => [l.id, l.amount]), [['clear', 40], ['rank', 30], ['stars', 50], ['first', 50]]);
    assert.equal(award.total, 170);
    assert.equal(calculateAward(clear({ rank: 'A' })).total, 30 + 20);
    assert.equal(calculateAward(clear({ rank: 'B' })).total, 30 + 10);
    assert.equal(calculateAward(clear({ rank: 'D' })).lines.length, 1);
    assert.equal(coinsText(170), '+170 coins');
    assert.equal(coinsText(1), '+1 coin');
});

test('award: Practice, tutorial, replays, Custom, failed and slowed runs earn nothing', () => {
    for (const run of [
        clear({ mode: 'practice' }), clear({ mode: 'tutorial', kind: 'tutorial' }), clear({ replay: true }),
        clear({ kind: 'custom' }), clear({ completed: false }), clear({ passed: false }),
        clear({ mode: 'quickPlay', speed: 0.75 }), clear({ mode: 'replay' }), clear({ difficulty: 'nightmare' }),
    ]) {
        assert.equal(calculateAward(run).total, 0, JSON.stringify(run));
    }
    assert.equal(awardsCoins({ mode: 'quickPlay', speed: 1 }), true);
    assert.equal(awardsCoins({ mode: 'daily', kind: 'daily' }), true);
});

test('award: daily pays no first-clear bonus', () => {
    const award = calculateAward(clear({ mode: 'daily', kind: 'daily', firstClear: true, difficulty: 'hard' }));
    assert.equal(award.lines.some((l) => l.id === 'first'), false);
});

test('prices: bots 400 (PULSE free), skins 150, crosshairs 100, themes 300; a skin needs its bot', () => {
    const price = (kind) => [...new Set(itemsOfKind(catalogue, kind).map((i) => i.price))].sort((a, b) => a - b);
    assert.deepEqual(price('bot'), [0, 400]);
    assert.deepEqual(price('skin'), [150]);
    assert.deepEqual(price('crosshair'), [0, 100]);
    assert.deepEqual(price('theme'), [0, 300]);
    assert.equal(byId.get('pulse-range-issue').price, 0);
    assert.equal(byId.get('woofer-midnight-disco').requires, 'woofer-boombox');
    assert.equal(itemsOfKind(catalogue, 'bot').length, 5);
    assert.equal(itemsOfKind(catalogue, 'skin').length, 10);
});

test('wallet: balance is earned minus paid, and free items are always owned', () => {
    let w = earn(emptyWallet(), 500);
    assert.equal(balance(w), 500);
    assert.equal(isOwned(w, byId.get('pulse-range-issue')), true);
    assert.equal(isOwned(w, byId.get('iris-watcher')), false);
    const bought = purchase(w, byId.get('iris-watcher'), byId);
    assert.equal(bought.ok, true);
    w = bought.wallet;
    assert.equal(balance(w), 100);
    assert.equal(isOwned(w, byId.get('iris-watcher')), true);
    assert.equal(earn(w, -5).earned, w.earned, 'negative and NaN awards are ignored');
    assert.equal(earn(w, NaN).earned, w.earned);
});

test('purchase: refuses when poor, owned or locked, and leaves the wallet untouched', () => {
    const w = earn(emptyWallet(), 399);
    const poor = purchase(w, byId.get('iris-watcher'), byId);
    assert.equal(poor.ok, false);
    assert.deepEqual(poor.status, { state: 'poor', missing: 1 });
    assert.equal(poor.wallet, w);
    const rich = earn(emptyWallet(), 1000);
    assert.equal(buyStatus(rich, byId.get('iris-ember'), byId).state, 'locked');
    assert.equal(purchase(rich, byId.get('iris-ember'), byId).ok, false);
    assert.equal(buyStatus(rich, byId.get('pulse-arctic'), byId).state, 'ready', 'PULSE is free so its skins are open');
    const own = purchase(rich, byId.get('iris-watcher'), byId).wallet;
    assert.equal(buyStatus(own, byId.get('iris-watcher'), byId).state, 'owned');
    assert.equal(buyStatus(own, byId.get('iris-ember'), byId).state, 'ready');
    assert.equal(purchase(own, byId.get('iris-watcher'), byId).ok, false, 'cannot pay twice');
});

test('merge: two devices never refund a purchase or lose an item', () => {
    const a = purchase(earn(emptyWallet(), 600), byId.get('iris-watcher'), byId).wallet; // 200 left
    const b = markCleared(earn(emptyWallet(), 300), 'neon:easy'); // older copy, nothing bought
    const merged = mergeWallets(a, b);
    assert.equal(merged.earned, 600);
    assert.equal(balance(merged), 200);
    assert.deepEqual(merged.cleared, ['neon:easy']);
    const c = purchase(earn(emptyWallet(), 600), byId.get('xh-ring'), byId).wallet;
    assert.equal(balance(mergeWallets(a, c)), 600 - 400 - 100, 'purchases from both sides count');
});

test('sanitise: junk in a save or profile cannot make a negative balance or fake ids', () => {
    const w = sanitiseWallet({ earned: -5, paid: { a: -1, b: 'x', ok: 50 }, owned: ['x', 7, null, 'x'], cleared: 'no' });
    assert.deepEqual(w, { earned: 0, paid: { ok: 50 }, owned: ['x'], cleared: [] });
    assert.equal(balance(w), 0);
    assert.deepEqual(sanitiseWallet(null), emptyWallet());
});

test('migration: cosmetics unlocked by stars (and equipped ones) become owned for nothing', () => {
    const legacy = { best: { 'neon:normal': [true, true, false] }, equipped: { theme: 'vault', crosshair: 'xh-hex' } };
    const w = migrateLegacy(legacy, catalogue, 13);
    for (const id of ['vault', 'xh-gap-cross', 'xh-ring', 'xh-chevron', 'xh-hex', 'xh-diamond']) {
        assert.ok(w.owned.includes(id), id);
    }
    assert.equal(w.owned.includes('xh-t-bar'), false, 'a 14-star crosshair is not owned at 13 stars');
    assert.equal(w.owned.includes('iris-watcher'), false, 'bots were never star-gated');
    assert.equal(w.earned, 0);
    assert.equal(balance(w), 0);
    assert.deepEqual(w.cleared, ['neon:normal']);
    assert.ok(migrateLegacy({ best: {}, equipped: { crosshair: 'xh-bracket' } }, catalogue, 0).owned.includes('xh-bracket'), 'an equipped item is kept');
    assert.deepEqual(migrateLegacy({ best: {}, equipped: {} }, catalogue, 0).owned, []);
});

test('store: progress saved before the Shop is migrated once and persisted', () => {
    const storage = memory();
    storage.write('progress', {
        best: { 'range:easy': [true, true, true], 'drift:hard': [true, true, true], 'neon:normal': [true, true, true], 'vault:easy': [true, true, true] },
        equipped: { theme: 'vault' }, calibrated: true,
    });
    const store = new ProgressStore(storage, { catalogue });
    assert.equal(store.total, 12);
    assert.equal(store.isOwned('vault'), true);
    assert.equal(store.isOwned('xh-gap-cross'), true);
    assert.equal(store.isOwned('xh-t-bar'), false);
    assert.equal(store.coins, 0);
    assert.ok(storage.data.get('progress').wallet, 'wallet saved with the progress');
    const again = new ProgressStore(storage, { catalogue });
    assert.deepEqual(again.values.wallet, store.values.wallet);
});

test('store: coins are paid per level, first clear once, and spent in the Shop', () => {
    const store = new ProgressStore(memory(), { catalogue });
    const run = { mode: 'campaign', trackId: 'neon', difficulty: 'hard' };
    const first = store.awardCoins(run, { rank: 'A', completed: true, passed: true }, 3);
    assert.equal(first.total, 40 + 20 + 75 + 50);
    assert.equal(store.coins, 185);
    const second = store.awardCoins(run, { rank: 'A', completed: true, passed: true }, 0);
    assert.equal(second.total, 60, 'no first-clear or star bonus the second time');
    assert.equal(store.awardCoins({ ...run, mode: 'practice' }, { rank: 'S', completed: true, passed: true }, 0).total, 0);
    assert.equal(store.coins, 245);
    assert.deepEqual(store.buy('iris-watcher').status, { state: 'poor', missing: 155 });
    assert.equal(store.buy('xh-ring').ok, true);
    assert.equal(store.coins, 145);
    assert.equal(store.equipItem('xh-ring'), true);
    assert.equal(store.equipped.crosshair, 'xh-ring');
    assert.equal(store.equipItem('iris-watcher'), false, 'not owned, cannot equip');
    assert.equal(store.buy('nope').ok, false);
    assert.equal(store.usable('iris-watcher', 'pulse-range-issue'), 'pulse-range-issue');
});

test('store: coins sync into the account copy like stars (union, no refund)', async () => {
    const remote = { value: null };
    const backend = {
        currentUser: () => ({ id: 'u' }), loadProgress: async () => remote.value, saveProgress: async (v) => { remote.value = structuredClone(v); },
    };
    const phone = new ProgressStore(memory(), { catalogue });
    phone.awardCoins({ mode: 'campaign', trackId: 'range', difficulty: 'easy' }, { rank: 'S', completed: true, passed: true }, 3);
    await phone.sync(backend);
    assert.equal(remote.value.wallet.earned, 20 + 30 + 75 + 50);
    const pc = new ProgressStore(memory(), { catalogue });
    await pc.sync(backend);
    assert.equal(pc.coins, 175, 'the other device sees the coins');
    pc.buy('xh-ring');
    await pc.sync(backend);
    await phone.sync(backend);
    assert.equal(phone.coins, 75);
    assert.equal(phone.isOwned('xh-ring'), true);
});

test('a legacy account profile (no wallet) is migrated when it is synced in', async () => {
    const stars = [true, true, true];
    const backend = {
        currentUser: () => ({ id: 'u' }),
        loadProgress: async () => ({ best: { 'range:easy': stars, 'neon:easy': stars, 'drift:easy': stars, 'vault:easy': stars }, equipped: {} }),
        saveProgress: async () => {},
    };
    const store = new ProgressStore(memory(), { catalogue });
    await store.sync(backend);
    assert.equal(store.isOwned('vault'), true);
});

test('coins never reach ranked: the edge rules copy has no economy and the validator never reads a wallet', () => {
    const edge = readFileSync(new URL('../../supabase/functions/_shared/rules/rulesData.js', import.meta.url), 'utf8');
    assert.doesNotMatch(edge, /economy|coin/i);
    for (const file of ['src/game/rules/validateRun.js', 'src/net/submit.js']) {
        assert.doesNotMatch(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), /wallet|coins|economy/i, file);
    }
});
