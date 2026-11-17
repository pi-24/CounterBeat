/**
 * SaveFile.js - versioned JSON save with per-key timestamps, the single file
 * registered for Steam Cloud (see docs/steam-cloud.md, data/steam.json).
 *
 * Wraps a Storage-like object ({read, write, remove, keys?}). Writes to synced
 * keys are stamped and mirrored (debounced) to the save file through `io`
 * ({ read():string|null, write(text) }), which the desktop shell provides.
 * Deleted keys leave a tombstone so they cannot resurrect from the cloud file.
 * Without `io` (browser) nothing is written to disk.
 */
import { isSyncedKey, mergeSave, parseSave, emptySave, SYNCED_KEYS, SYNCED_PREFIXES, SAVE_VERSION } from './mergeSave.js';

export const META_KEY = 'save.meta';
export const FLUSH_DELAY_MS = 500;

export class SaveFile {
    /**
     * @param {object} storage
     * @param {{read:Function, write:Function}|null} io
     * @param {{now?:Function, delayMs?:number, setTimer?:Function, clearTimer?:Function}|Function} [opts]
     */
    constructor(storage, io = null, opts = {}) {
        this.storage = storage;
        this.io = io;
        const o = typeof opts === 'function' ? { now: opts } : opts;
        this.now = o.now ?? (() => Date.now());
        this.delayMs = o.delayMs ?? FLUSH_DELAY_MS;
        this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
        this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h));
        this.timer = null;
    }

    read(key, fallback) { return this.storage.read(key, fallback); }

    write(key, value) {
        const ok = this.storage.write(key, value);
        if (ok) this.touch(key, false);
        return ok;
    }

    remove(key) {
        this.storage.remove?.(key);
        this.touch(key, true);
    }

    /** Stamps a synced key (or tombstones it) and schedules a flush. */
    touch(key, deleted) {
        if (!isSyncedKey(key)) return;
        const meta = this.storage.read(META_KEY, {});
        meta[key] = deleted ? { t: this.now(), deleted: true } : { t: this.now() };
        this.storage.write(META_KEY, meta);
        this.scheduleFlush();
    }

    /** Stamps synced keys that exist in storage but have no timestamp (legacy progress). */
    backfill() {
        const meta = this.storage.read(META_KEY, {});
        const names = new Set(SYNCED_KEYS);
        for (const k of this.storage.keys?.() ?? []) if (SYNCED_PREFIXES.some((p) => k.startsWith(p))) names.add(k);
        let changed = false;
        for (const name of names) {
            if (meta[name] === undefined && this.storage.read(name, undefined) !== undefined) {
                meta[name] = { t: this.now() }; // local priority: legacy progress beats an older remote
                changed = true;
            }
        }
        if (changed) this.storage.write(META_KEY, meta);
    }

    /** Current local state as a save object (synced keys only). */
    snapshot() {
        const meta = this.storage.read(META_KEY, {});
        const save = emptySave();
        for (const name of Object.keys(meta).sort()) {
            const m = meta[name];
            if (!isSyncedKey(name) || !m || !Number.isFinite(m.t)) continue;
            if (m.deleted) { save.keys[name] = { t: m.t, deleted: true }; continue; }
            const v = this.storage.read(name, undefined);
            if (v !== undefined) save.keys[name] = { t: m.t, v };
        }
        return save;
    }

    scheduleFlush() {
        if (!this.io) return;
        if (this.delayMs <= 0) { this.flush(); return; }
        if (this.timer !== null) return; // trailing edge: coalesce bursts
        this.timer = this.setTimer(() => { this.timer = null; this.flush(); }, this.delayMs);
    }

    /** Writes the save file for Steam Cloud to pick up (immediately). */
    flush() {
        if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
        if (!this.io) return false;
        try { this.io.write(JSON.stringify(this.snapshot())); return true; } catch { return false; }
    }

    /** Merges the file on disk (possibly cloud-updated) into local storage. Call once at launch. */
    syncFromFile() {
        if (!this.io) return null;
        this.backfill();
        let text = null;
        try { text = this.io.read(); } catch { /* fall back to local */ }
        const result = mergeSave(this.snapshot(), text);
        const meta = this.storage.read(META_KEY, {});
        for (const name of result.takenFromRemote) {
            const e = result.save.keys[name];
            if (e.deleted) { this.storage.remove?.(name); meta[name] = { t: e.t, deleted: true }; }
            else { this.storage.write(name, e.v); meta[name] = { t: e.t }; }
        }
        if (result.takenFromRemote.length) this.storage.write(META_KEY, meta);
        this.flush();
        return result;
    }

    /**
     * Routes a Storage instance's writes/removes through this SaveFile in place,
     * so existing `store.write(...)` call sites are saved without changes.
     * Flushes pending writes on page hide / blur.
     */
    attach(storage = this.storage, target = globalThis) {
        const rawWrite = storage.write.bind(storage);
        const rawRemove = storage.remove.bind(storage);
        storage.write = (key, value) => { const ok = rawWrite(key, value); if (ok) this.touch(key, false); return ok; };
        storage.remove = (key) => { rawRemove(key); this.touch(key, true); };
        const flushNow = () => { if (this.timer !== null) this.flush(); };
        for (const ev of ['pagehide', 'blur', 'beforeunload']) target.addEventListener?.(ev, flushNow);
        return this;
    }
}

export { SAVE_VERSION, parseSave };
