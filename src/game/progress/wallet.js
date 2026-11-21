/**
 * wallet.js
 *
 * Pure coin wallet, kept inside ProgressStore beside the stars and synced the
 * same way (local storage, Steam Cloud save, Supabase profile). Never sent with
 * a ranked submission and never read by the server.
 *
 *   earned   lifetime coins earned
 *   paid     { itemId: price } for every item bought
 *   owned    item ids owned without paying (migrated from stars)
 *   cleared  chart keys ('track:difficulty') cleared once, for the first-clear bonus
 *
 * balance = earned - sum(paid).  Because the balance is derived, two devices
 * merge without ever refunding a purchase: earned takes the larger side, paid
 * and owned and cleared are unions.  Equipped ids stay in ProgressStore.values.equipped.
 */

export const emptyWallet = () => ({ earned: 0, paid: {}, owned: [], cleared: [] });

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

/** Clean copy of untrusted wallet data (local storage, cloud save, profile). */
export function sanitiseWallet(raw) {
    const out = emptyWallet();
    if (!raw || typeof raw !== 'object') {
        return out;
    }
    if (Number.isFinite(raw.earned) && raw.earned > 0) {
        out.earned = Math.floor(raw.earned);
    }
    for (const [id, price] of Object.entries(raw.paid ?? {})) {
        if (isId(id) && Number.isFinite(price) && price > 0) {
            out.paid[id] = Math.floor(price);
        }
    }
    out.owned = [...new Set((Array.isArray(raw.owned) ? raw.owned : []).filter(isId))];
    out.cleared = [...new Set((Array.isArray(raw.cleared) ? raw.cleared : []).filter(isId))];
    return out;
}

/** @param {ReturnType<typeof emptyWallet>} wallet @returns {number} coins available to spend */
export function balance(wallet) {
    const spent = Object.values(wallet.paid).reduce((sum, price) => sum + price, 0);
    return Math.max(0, wallet.earned - spent);
}

/** @param {{id:string, price:number}} item a free item (price 0) is always owned */
export function isOwned(wallet, item) {
    return item.price === 0 || wallet.owned.includes(item.id) || item.id in wallet.paid;
}

/** @returns {ReturnType<typeof emptyWallet>} a new wallet with `amount` coins added */
export function earn(wallet, amount) {
    const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
    return { ...wallet, earned: wallet.earned + add };
}

/** @returns {ReturnType<typeof emptyWallet>} a new wallet with the chart marked cleared */
export function markCleared(wallet, key) {
    return wallet.cleared.includes(key) ? wallet : { ...wallet, cleared: [...wallet.cleared, key] };
}

/**
 * Where an item stands for this wallet.
 *   owned   already yours
 *   locked  needs another item first (a skin needs its bot); `requires` is that item
 *   poor    not enough coins; `missing` says how many more
 *   ready   can be bought now
 * @param {Map<string, object>} byId catalogue index, to resolve `requires`
 */
export function buyStatus(wallet, item, byId) {
    if (isOwned(wallet, item)) {
        return { state: 'owned' };
    }
    const needed = item.requires ? byId.get(item.requires) : null;
    if (needed && !isOwned(wallet, needed)) {
        return { state: 'locked', requires: needed };
    }
    const have = balance(wallet);
    return have >= item.price ? { state: 'ready' } : { state: 'poor', missing: item.price - have };
}

/** @returns {{ok:boolean, wallet:object, status:object}} the wallet is unchanged when not ok */
export function purchase(wallet, item, byId) {
    const status = buyStatus(wallet, item, byId);
    if (status.state !== 'ready') {
        return { ok: false, wallet, status };
    }
    return { ok: true, wallet: { ...wallet, paid: { ...wallet.paid, [item.id]: item.price } }, status };
}

/** Union merge of two devices' wallets (see the header for why this never refunds). */
export function mergeWallets(a, b) {
    const paid = { ...a.paid };
    for (const [id, price] of Object.entries(b.paid)) {
        paid[id] = Math.max(paid[id] ?? 0, price);
    }
    return {
        earned: Math.max(a.earned, b.earned),
        paid,
        owned: [...new Set([...a.owned, ...b.owned])],
        cleared: [...new Set([...a.cleared, ...b.cleared])],
    };
}

/**
 * Wallet for progress saved before the Shop existed: every cosmetic the star
 * total had unlocked, and everything equipped, becomes owned for nothing; every
 * chart with a pass star counts as cleared. Coins start at 0.
 * @param {{best?:Record<string, boolean[]>, equipped?:Record<string,string>}} legacy sanitised old progress
 * @param {{id:string, price:number, starCost:number}[]} catalogue
 * @param {number} stars the old total
 */
export function migrateLegacy(legacy, catalogue, stars) {
    const wallet = emptyWallet();
    const equipped = new Set(Object.values(legacy.equipped ?? {}));
    for (const item of catalogue) {
        if (item.price > 0 && ((item.starCost > 0 && stars >= item.starCost) || equipped.has(item.id))) {
            wallet.owned.push(item.id);
        }
    }
    for (const [key, flags] of Object.entries(legacy.best ?? {})) {
        if (flags?.[0]) {
            wallet.cleared.push(key);
        }
    }
    return wallet;
}
