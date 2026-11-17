/**
 * mergeSave.js - pure, deterministic Steam Cloud conflict rule.
 *
 * Save shape: { version: 1, keys: { [name]: { t: <ms timestamp>, v: <json value> } | { t, deleted: true } } }
 * Clock skew between PCs is accepted: Date.now() is the only ordering (see docs/steam-cloud.md).
 * Rule: per key, the newer timestamp wins and the whole value is taken (no
 * field-level merging). Equal timestamps: local wins. A key present on one
 * side only is kept. Ranked / leaderboard / account data is never part of the
 * save: such keys are dropped from both sides and from the result.
 */
export const SAVE_VERSION = 1;

/** Exact key names and prefixes that may be saved. Anything else is skipped. */
export const SYNCED_KEYS = Object.freeze(['settings', 'progress', 'onboarding']);
export const SYNCED_PREFIXES = Object.freeze(['localBests:']);

/** Keys that must never enter the save (ranked, replays, accounts). */
const RANKED_PATTERN = /^(scores|logs|users|session|account\.|ranked|leaderboard|daily)/i;

export function isSyncedKey(key) {
    if (typeof key !== 'string' || RANKED_PATTERN.test(key)) return false;
    return SYNCED_KEYS.includes(key) || SYNCED_PREFIXES.some((p) => key.startsWith(p));
}

export function emptySave() {
    return { version: SAVE_VERSION, keys: {} };
}

/** Returns a clean save, or null when the input is unusable. Accepts a JSON string. */
export function parseSave(input) {
    let data = input;
    if (typeof input === 'string') {
        try { data = JSON.parse(input); } catch { return null; }
    }
    if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION
        || !data.keys || typeof data.keys !== 'object' || Array.isArray(data.keys)) return null;
    const keys = {};
    for (const name of Object.keys(data.keys).sort()) {
        const e = data.keys[name];
        if (!isSyncedKey(name) || !e || typeof e !== 'object' || !Number.isFinite(e.t)) continue;
        if (e.deleted === true) keys[name] = { t: e.t, deleted: true }; // tombstone: takes part in newer-wins
        else if ('v' in e) keys[name] = { t: e.t, v: e.v };
    }
    return { version: SAVE_VERSION, keys };
}

/**
 * @param {object|string|null} local
 * @param {object|string|null} remote
 * @returns {{save:object, source:'local'|'merged', takenFromRemote:string[]}}
 */
export function mergeSave(local, remote) {
    const l = parseSave(local) ?? emptySave();
    const r = parseSave(remote);
    if (!r) return { save: l, source: 'local', takenFromRemote: [] };
    const keys = {};
    const takenFromRemote = [];
    for (const name of [...new Set([...Object.keys(l.keys), ...Object.keys(r.keys)])].sort()) {
        const a = l.keys[name];
        const b = r.keys[name];
        if (a && (!b || a.t >= b.t)) keys[name] = { ...a };
        else { keys[name] = { ...b }; takenFromRemote.push(name); }
    }
    return { save: { version: SAVE_VERSION, keys }, source: takenFromRemote.length ? 'merged' : 'local', takenFromRemote };
}
