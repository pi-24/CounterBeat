/**
 * unlocks.js
 *
 * Star-total unlocks. Tracks 2..6 open at RULES.starGates (3/8/14/21/28);
 * crosshairs, themes and target skins open at their manifest `starCost`.
 * Difficulty clears play no part.
 */
import { RULES } from '../rules/rules.js';

/** @param {number} trackIndex 0-based position in the campaign order */
export function trackGate(trackIndex) {
    return RULES.starGates[trackIndex] ?? Infinity;
}

export function isTrackUnlocked(trackIndex, stars) {
    return stars >= trackGate(trackIndex);
}

/** @param {string[]} trackIds in campaign order */
export function trackStates(trackIds, stars) {
    const out = {};
    trackIds.forEach((id, i) => {
        out[id] = { gate: trackGate(i), unlocked: isTrackUnlocked(i, stars) };
    });
    return out;
}

/** @param {{starCost?:number}} entry */
export function isCosmeticUnlocked(entry, stars) {
    return stars >= (entry.starCost ?? 0);
}

/** @param {Array<{id:string, starCost?:number}>} entries */
export function cosmeticStates(entries, stars) {
    return entries.map((e) => ({ id: e.id, starCost: e.starCost ?? 0, unlocked: isCosmeticUnlocked(e, stars) }));
}

/** Ids newly unlocked when the total moves from `before` to `after`. */
export function newlyUnlocked(trackIds, groups, before, after) {
    const ids = [];
    trackIds.forEach((id, i) => {
        if (!isTrackUnlocked(i, before) && isTrackUnlocked(i, after)) {
            ids.push(`track:${id}`);
        }
    });
    for (const [kind, entries] of Object.entries(groups)) {
        for (const e of entries) {
            if (!isCosmeticUnlocked(e, before) && isCosmeticUnlocked(e, after)) {
                ids.push(`${kind}:${e.id}`);
            }
        }
    }
    return ids;
}
