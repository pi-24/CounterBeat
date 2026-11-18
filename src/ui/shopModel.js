/**
 * shopModel.js - what the Shop screen shows, as plain data (no DOM), so it is unit-tested.
 * The screen (ShopScreen.js) only paints this and forwards clicks.
 */
import { SHOP_CATEGORIES, itemsOfKind } from '../game/progress/shopCatalog.js';
import { buyStatus, balance } from '../game/progress/wallet.js';

/** @param {number} n */
export const coinLabel = (n) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'coin' : 'coins'}`;

/**
 * The one-line message a purchase attempt gets, by where the item stands.
 * @param {{state:string, missing?:number, requires?:{name:string}}} status from wallet.buyStatus
 * @param {{name:string, price:number}} item
 */
export function statusMessage(status, item) {
    switch (status.state) {
    case 'owned': return `${item.name} is already yours.`;
    case 'locked': return `Buy the ${status.requires.name} bot first.`;
    case 'poor': return `Not enough coins: ${item.name} costs ${coinLabel(item.price)}, you need ${coinLabel(status.missing)} more. Clear levels to earn them.`;
    case 'ready': return `Buy ${item.name} for ${coinLabel(item.price)}?`;
    default: return '';
    }
}

/**
 * @param {object[]} catalogue Shop items (shopCatalog.buildCatalogue)
 * @param {{wallet:object, equipped:Record<string,string>}} progress
 * @param {{tab?:string, selectedId?:string|null}} [choice]
 * @returns {{
 *   coins:number, tab:string, tabs:{id:string, label:string, count:number, owned:number}[],
 *   items:{id:string, name:string, kind:string, price:number, priceText:string, state:string, badge:string, equipped:boolean, owned:boolean, bot?:string}[],
 *   selected:object|null
 * }}
 */
export function buildShopView(catalogue, progress, choice = {}) {
    const byId = new Map(catalogue.map((item) => [item.id, item]));
    const { wallet } = progress;
    // Nothing equipped yet means the free default is in use (the first bot and crosshair); themes default to each track's own.
    const equipped = { ...progress.equipped };
    for (const slot of ['targetSkin', 'crosshair']) {
        const current = byId.get(equipped[slot]);
        if (!current || current.slot !== slot || !buyStatus(wallet, current, byId).state.startsWith('owned')) {
            equipped[slot] = catalogue.find((item) => item.slot === slot)?.id;
        }
    }
    const tab = SHOP_CATEGORIES.some((c) => c.id === choice.tab) ? choice.tab : SHOP_CATEGORIES[0].id;
    const row = (item) => {
        const status = buyStatus(wallet, item, byId);
        const owned = status.state === 'owned';
        const isEquipped = owned && equipped[item.slot] === item.id;
        return {
            id: item.id, name: item.name, kind: item.kind, bot: item.bot, price: item.price,
            priceText: owned ? '' : coinLabel(item.price), state: status.state, owned, equipped: isEquipped,
            badge: isEquipped ? 'EQUIPPED' : owned ? 'OWNED' : status.state === 'locked' ? 'LOCKED' : '', status,
        };
    };
    const tabs = SHOP_CATEGORIES.map((c) => {
        const rows = itemsOfKind(catalogue, c.id).map(row);
        return { id: c.id, label: c.label, count: rows.length, owned: rows.filter((r) => r.owned).length };
    });
    const items = itemsOfKind(catalogue, tab).map(row);
    const selected = items.find((r) => r.id === choice.selectedId) ?? items.find((r) => r.equipped) ?? items[0] ?? null;
    return { coins: balance(wallet), tab, tabs, items, selected: selected && { ...selected, action: actionFor(selected) } };
}

/**
 * The button the detail panel offers for an item.
 * @returns {{kind:'equipped'|'equip'|'buy', label:string, disabled?:boolean}}
 */
export function actionFor(row) {
    if (row.equipped) return { kind: 'equipped', label: 'Equipped', disabled: true };
    if (row.owned) return { kind: 'equip', label: 'Equip' };
    return { kind: 'buy', label: row.priceText ? `Buy · ${row.priceText}` : 'Buy' };
}

/**
 * The settings an equipped item changes (the equipped id itself lives in ProgressStore).
 * @param {{kind:string, id:string, entry:object}} item
 * @param {number} currentLength the player's current crosshair arm length
 * @returns {object|null} a Settings.update() patch, or null when the item changes no setting (themes)
 */
export function equipSettingsPatch(item, currentLength) {
    if (item.slot === 'targetSkin') {
        return { targetSkin: item.id };
    }
    if (item.slot === 'crosshair') {
        const dot = item.entry.shape === 'dot';
        return { crosshairColour: item.entry.colour, crosshairDot: dot, crosshairLength: dot ? 0 : Math.max(currentLength, 6) };
    }
    return null;
}
