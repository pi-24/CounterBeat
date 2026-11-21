import { indexById } from './AssetProvider.js';

/** Arena themes, target skins and crosshairs (data/themes|targets|crosshairs.json). */
export class ThemeProvider {
    constructor(themes, targets, crosshairs) {
        this.themes = indexById(themes.themes, 'theme');
        this.targets = indexById(targets.targets, 'target');
        this.crosshairs = indexById(crosshairs.crosshairs, 'crosshair');
        /** @type {WeakMap<object, object>} merged arenas, one per rules arena object */
        this.arenaCache = new WeakMap();
        this.warned = new Set();
    }

    /** @param {string} id */
    theme(id) {
        const theme = this.themes.get(id);
        if (!theme) throw new Error(`Unknown theme "${id}"`);
        return theme;
    }

    /** Merges a rules-level arena ({theme, overrides...}) with its theme data. */
    resolveArena(arena) {
        let merged = this.arenaCache.get(arena);
        if (!merged) {
            merged = { ...this.theme(arena.theme), ...arena };
            this.arenaCache.set(arena, merged);
        }
        return merged;
    }

    /** @param {string} [id] falls back to the first (default) skin */
    target(id) {
        return this.lookup(this.targets, 'target', id);
    }

    /** @param {string} [id] */
    crosshair(id) {
        return this.lookup(this.crosshairs, 'crosshair', id);
    }

    /** Undefined id = default (first) entry. An unknown id also falls back, but warns once. */
    lookup(map, kind, id) {
        const found = id === undefined ? undefined : map.get(id);
        if (!found && id !== undefined && !this.warned.has(`${kind}:${id}`)) {
            this.warned.add(`${kind}:${id}`);
            console.warn(`ThemeProvider: unknown ${kind} "${id}", using the default`);
        }
        return found ?? map.values().next().value;
    }

    /** Entries of `kind` ('themes'|'targets'|'crosshairs') a player with `stars` may use. */
    unlocked(kind, stars) {
        return [...this[kind].values()].filter((entry) => entry.starCost <= stars);
    }
}
