/**
 * store.js
 *
 * ProgressStore: best stars per chart, equipped cosmetics and the
 * calibrated flag. Persisted in local storage and mirrored to the account's
 * profile (backend.loadProgress/saveProgress) when logged in. Settings and
 * the measured audio offset live in Settings.js, which syncs the same way.
 * NOT server-verified and never read by ranked submission (README).
 */
import { store as defaultStorage } from '../../core/Storage.js';
import { awardsStars, calculateStars, countStars, mergeBest, totalStars, chartKey } from './stars.js';

const KEY = 'progress';
const SAVE_DELAY_MS = 800;
const empty = () => ({ best: {}, equipped: {}, calibrated: false });

export class ProgressStore {
    constructor(storage = defaultStorage) {
        this.storage = storage;
        this.values = ProgressStore.sanitise(storage.read(KEY, {}));
        this.backend = null;
        this.listeners = new Set();
        this.saveTimer = 0;
    }

    static sanitise(raw) {
        const out = empty();
        if (!raw || typeof raw !== 'object') {
            return out;
        }
        for (const [key, flags] of Object.entries(raw.best ?? {})) {
            if (Array.isArray(flags)) {
                out.best[key] = [0, 1, 2].map((i) => flags[i] === true);
            }
        }
        for (const [kind, id] of Object.entries(raw.equipped ?? {})) {
            if (typeof id === 'string') {
                out.equipped[kind] = id;
            }
        }
        out.calibrated = raw.calibrated === true;
        return out;
    }

    get total() {
        return totalStars(this.values.best);
    }

    starsFor(trackId, difficulty) {
        return this.values.best[chartKey(trackId, difficulty)] ?? [false, false, false];
    }

    onChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /**
     * Records a finished run.
     * @param {{mode:string, trackId:string, difficulty:string, speed?:number}} run
     * @param {object} result a Scorer record (accuracy, perfect, good, loose, missed, notes, completed)
     * @returns {{earned:boolean[], newStars:number, total:number, before:number}}
     */
    record(run, result) {
        const before = this.total;
        if (!awardsStars({ ...run, completed: result.completed })) {
            return { earned: [false, false, false], newStars: 0, total: before, before };
        }
        const earned = calculateStars({ ...result, difficulty: run.difficulty });
        const prev = this.starsFor(run.trackId, run.difficulty);
        const merged = [0, 1, 2].map((i) => prev[i] || earned[i]);
        this.values.best[chartKey(run.trackId, run.difficulty)] = merged;
        this.persist();
        this.flush();
        return { earned, newStars: countStars(merged) - countStars(prev), total: this.total, before };
    }

    equip(kind, id) {
        this.values.equipped[kind] = id;
        this.persist();
    }

    setCalibrated(done = true) {
        this.values.calibrated = done;
        this.persist();
    }

    persist() {
        this.storage.write(KEY, this.values);
        for (const fn of this.listeners) {
            fn(this.values);
        }
        this.scheduleRemoteSave();
    }

    /** Union-merges the account copy with the local one so stars are never lost. */
    async sync(backend) {
        this.backend = backend;
        if (!this.pagehideBound && typeof globalThis.addEventListener === 'function') {
            this.pagehideBound = true;
            globalThis.addEventListener('pagehide', () => this.flush());
        }
        if (!backend.currentUser() || !backend.loadProgress) {
            return;
        }
        try {
            const remote = ProgressStore.sanitise(await backend.loadProgress());
            this.values = {
                best: mergeBest(this.values.best, remote.best),
                equipped: { ...remote.equipped, ...this.values.equipped },
                calibrated: this.values.calibrated || remote.calibrated,
            };
            this.storage.write(KEY, this.values);
            await backend.saveProgress(this.values);
            for (const fn of this.listeners) {
                fn(this.values);
            }
        } catch (error) {
            console.warn('Progress: could not sync', error);
        }
    }

    /** @returns {boolean} whether an account save is possible right now */
    canSync() {
        return Boolean(this.backend && this.backend.saveProgress && this.backend.currentUser());
    }

    /** Sends any pending account save now (after a run, and on pagehide). */
    flush() {
        if (!this.canSync()) {
            return;
        }
        globalThis.clearTimeout(this.saveTimer);
        this.saveTimer = 0;
        Promise.resolve(this.backend.saveProgress(this.values)).catch((e) => console.warn('Progress: save failed', e));
    }

    scheduleRemoteSave() {
        if (!this.canSync()) {
            return;
        }
        globalThis.clearTimeout(this.saveTimer);
        this.saveTimer = globalThis.setTimeout(() => {
            this.saveTimer = 0;
            Promise.resolve(this.backend.saveProgress(this.values)).catch((e) => console.warn('Progress: save failed', e));
        }, SAVE_DELAY_MS);
    }
}
