/**
 * store.js
 *
 * ProgressStore: best stars per chart, the coin wallet (coins earned, items
 * owned), equipped cosmetics and the calibrated flag. Persisted in local storage and mirrored to the account's
 * profile (backend.loadProgress/saveProgress) when logged in. Settings and
 * the measured audio offset live in Settings.js, which syncs the same way.
 * NOT server-verified and never read by ranked submission (README).
 */
import { store as defaultStorage } from '../../core/Storage.js';
import { awardsStars, calculateStars, countStars, mergeBest, totalStars, chartKey } from './stars.js';
import { calculateAward } from './coins.js';
import { indexCatalogue, SLOT_OF } from './shopCatalog.js';
import {
    emptyWallet, sanitiseWallet, migrateLegacy, mergeWallets, balance, isOwned, earn, markCleared, purchase,
} from './wallet.js';

const KEY = 'progress';
const SAVE_DELAY_MS = 800;
const empty = () => ({ best: {}, equipped: {}, calibrated: false, wallet: emptyWallet() });

export class ProgressStore {
    /**
     * @param {object} [storage]
     * @param {{catalogue?: object[]}} [options] the Shop catalogue (shopCatalog.js); without it nothing
     *   can be bought and progress saved before the Shop is not migrated
     */
    constructor(storage = defaultStorage, options = {}) {
        this.storage = storage;
        this.catalogue = options.catalogue ?? [];
        this.byId = indexCatalogue(this.catalogue);
        const raw = storage.read(KEY, {});
        this.values = ProgressStore.sanitise(raw, this.catalogue);
        if (raw && typeof raw === 'object' && Object.keys(raw).length > 0 && !raw.wallet && this.catalogue.length > 0) {
            storage.write(KEY, this.values); // migrated once; the wallet exists from now on
        }
        this.backend = null;
        this.listeners = new Set();
        this.saveTimer = 0;
    }

    /**
     * @param {object} raw untrusted saved progress
     * @param {object[]} [catalogue] used to migrate progress that has no wallet yet
     */
    static sanitise(raw, catalogue = []) {
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
        out.wallet = raw.wallet && typeof raw.wallet === 'object'
            ? sanitiseWallet(raw.wallet)
            : migrateLegacy(out, catalogue, totalStars(out.best));
        return out;
    }

    get total() {
        return totalStars(this.values.best);
    }

    /** @returns {number} coins available to spend */
    get coins() {
        return balance(this.values.wallet);
    }

    /** @returns {Record<string,string>} equipped item id per slot (targetSkin, crosshair, theme) */
    get equipped() {
        return this.values.equipped;
    }

    /** @param {string} id a Shop item id @returns {boolean} owned, or free */
    isOwned(id) {
        const item = this.byId.get(id);
        return item ? isOwned(this.values.wallet, item) : false;
    }

    /** The id to use for a slot: the wanted one if owned, else `fallback`. */
    usable(id, fallback) {
        return id && this.isOwned(id) ? id : fallback;
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

    /**
     * Pays out the coins for a finished run (Campaign, Quick Play and Daily only; see coins.js).
     * Call after record(): `newStars` is the stars that run earned for the first time.
     * @param {{mode:string, kind?:string, trackId?:string, difficulty:string, speed?:number}} run
     * @param {{rank:string, completed?:boolean, passed?:boolean}} result a Scorer record
     * @param {number} [newStars]
     * @returns {{total:number, lines:object[]}} what was added
     */
    awardCoins(run, result, newStars = 0) {
        const key = chartKey(run.trackId, run.difficulty);
        const isTrack = (run.kind ?? 'track') === 'track';
        const award = calculateAward({
            mode: run.mode, kind: run.kind ?? 'track', speed: run.speed, difficulty: run.difficulty, rank: result.rank,
            completed: result.completed, passed: result.passed, newStars,
            firstClear: isTrack && !this.values.wallet.cleared.includes(key),
        });
        if (award.total === 0) {
            return award;
        }
        let wallet = earn(this.values.wallet, award.total);
        if (isTrack) {
            wallet = markCleared(wallet, key);
        }
        this.values.wallet = wallet;
        this.persist();
        this.flush();
        return award;
    }

    /**
     * Buys a Shop item with coins.
     * @param {string} id
     * @returns {{ok:boolean, status:object}} status.state: owned | locked | poor | ready (before the purchase)
     */
    buy(id) {
        const item = this.byId.get(id);
        if (!item) {
            return { ok: false, status: { state: 'unknown' } };
        }
        const result = purchase(this.values.wallet, item, this.byId);
        if (result.ok) {
            this.values.wallet = result.wallet;
            this.persist();
            this.flush();
        }
        return { ok: result.ok, status: result.status };
    }

    /** Equips an owned Shop item into its slot. @returns {boolean} false when it is not owned */
    equipItem(id) {
        const item = this.byId.get(id);
        if (!item || !this.isOwned(id)) {
            return false;
        }
        this.equip(SLOT_OF[item.kind], id);
        return true;
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

    /** Union-merges the account copy with the local one so stars and coins are never lost. */
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
            const remote = ProgressStore.sanitise(await backend.loadProgress(), this.catalogue);
            this.values = {
                best: mergeBest(this.values.best, remote.best),
                equipped: { ...remote.equipped, ...this.values.equipped },
                calibrated: this.values.calibrated || remote.calibrated,
                wallet: mergeWallets(this.values.wallet, remote.wallet),
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
