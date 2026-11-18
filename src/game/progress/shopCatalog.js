/**
 * shopCatalog.js
 *
 * The Shop's item list, built from the manifests (data/targets|crosshairs|themes.json).
 * Pure: it takes the manifest entries and the economy rules as arguments.
 *   bot       the first design of each bot (PULSE is the free default)
 *   skin      the other designs of a bot; they need the bot itself first
 *   crosshair / theme
 * An entry's own `coinPrice` wins; otherwise the economy's per-kind price.
 * `starCost` survives only to migrate cosmetics players had unlocked by stars.
 */

export const SHOP_CATEGORIES = Object.freeze([
    Object.freeze({ id: 'bot', label: 'Bots', plural: 'bots' }),
    Object.freeze({ id: 'skin', label: 'Skins', plural: 'skins' }),
    Object.freeze({ id: 'crosshair', label: 'Crosshairs', plural: 'crosshairs' }),
    Object.freeze({ id: 'theme', label: 'Themes', plural: 'themes' }),
]);

/** Which equipped slot each kind fills (bots and skins are both a target sprite). */
export const SLOT_OF = Object.freeze({ bot: 'targetSkin', skin: 'targetSkin', crosshair: 'crosshair', theme: 'theme' });

const priceOf = (entry, kind, economy) => (Number.isFinite(entry.coinPrice) ? entry.coinPrice : economy.prices[kind]);

/**
 * @param {{targets:{targets:object[]}, crosshairs:{crosshairs:object[]}, themes:{themes:object[]}}} manifests
 * @param {{prices:Record<string, number>}} economy
 * @returns {{id:string, kind:string, slot:string, name:string, price:number, starCost:number, requires:string|null, bot?:string, entry:object}[]}
 */
export function buildCatalogue(manifests, economy) {
    const items = [];
    const botBase = new Map();
    for (const entry of manifests.targets.targets) {
        const first = !botBase.has(entry.bot);
        if (first) {
            botBase.set(entry.bot, entry.id);
        }
        const kind = first ? 'bot' : 'skin';
        items.push({
            id: entry.id, kind, slot: SLOT_OF[kind], name: entry.name, bot: entry.bot,
            price: priceOf(entry, kind, economy), starCost: entry.starCost ?? 0,
            requires: first ? null : botBase.get(entry.bot), entry,
        });
    }
    for (const entry of manifests.crosshairs.crosshairs) {
        items.push({
            id: entry.id, kind: 'crosshair', slot: 'crosshair', name: entry.name,
            price: priceOf(entry, 'crosshair', economy), starCost: entry.starCost ?? 0, requires: null, entry,
        });
    }
    for (const entry of manifests.themes.themes) {
        items.push({
            id: entry.id, kind: 'theme', slot: 'theme', name: entry.name,
            price: priceOf(entry, 'theme', economy), starCost: entry.starCost ?? 0, requires: null, entry,
        });
    }
    return items;
}

/** @param {object[]} catalogue @returns {Map<string, object>} */
export function indexCatalogue(catalogue) {
    return new Map(catalogue.map((item) => [item.id, item]));
}

/** @param {object[]} catalogue @param {string} kind */
export function itemsOfKind(catalogue, kind) {
    return catalogue.filter((item) => item.kind === kind);
}
