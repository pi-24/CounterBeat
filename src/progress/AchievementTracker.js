/**
 * AchievementTracker.js
 *
 * Maps FeedbackBus events to Steam achievements (data/achievements.json).
 * Cosmetic / progression only: it is NEVER imported by ranked submission or
 * server validation code (tests/unit/achievements.test.mjs enforces this).
 *
 * Two sets are kept: `earned` (the trigger fired; idempotent, so an earned id
 * is a no-op) and `delivered` (Steam accepted it). Earned-but-undelivered ids
 * stay pending, silently, while Steam is absent or refuses, and are retried
 * whenever Steam is attached and at every run end - so a browser run or a
 * session started before Steam was up never burns an achievement.
 * Counters live in memory; storage is written on earn, delivery, run end and
 * pagehide (persist()), never per shot.
 */
const KEY = 'achievements';

/** Events the game emits on the FeedbackBus that achievements may listen to. */
export const ACHIEVEMENT_EVENTS = Object.freeze([
    'runComplete', 'starsChanged', 'tutorialComplete', 'practiceLoopPass', 'perfectStop', 'hit',
]);

export function matches(where, payload) {
    return Object.entries(where ?? {}).every(([k, v]) => payload?.[k] === v);
}

export class AchievementTracker {
    /**
     * @param {{on:Function}} bus FeedbackBus
     * @param {{read:Function, write:Function}} storage
     * @param {object|(() => object|null)|null} [steam] the bridge, or a getter resolved at each flush
     * @param {object[]} achievements the data/achievements.json list (imported by the page, so Node tests can load this file)
     */
    constructor(bus, storage, steam = null, achievements = []) {
        this.storage = storage;
        this.steam = steam;
        this.achievements = achievements;
        this.inflight = new Set();
        this.dirty = false;
        const raw = storage.read(KEY, {});
        const ids = (v) => new Set(Array.isArray(v) ? v : []);
        this.delivered = ids(raw?.delivered ?? raw?.unlocked);
        this.earned = ids(raw?.unlocked);
        this.delivered.forEach((id) => this.earned.add(id));
        this.counts = { ...(raw?.counts ?? {}) };
        this.byEvent = new Map();
        for (const a of achievements) {
            if (!this.byEvent.has(a.trigger.event)) this.byEvent.set(a.trigger.event, []);
            this.byEvent.get(a.trigger.event).push(a);
        }
        this.offs = [...this.byEvent.keys()].map((event) => bus.on(event, (payload) => this.handle(event, payload)));
        this.flush();
    }

    handle(event, payload) {
        let earnedNow = false;
        for (const a of this.byEvent.get(event) ?? []) {
            const t = a.trigger;
            if (this.earned.has(a.id)) {
                continue;
            }
            if (t.field) {
                if (Number(payload?.[t.field]) >= t.threshold) {
                    earnedNow = this.earn(a) || earnedNow;
                }
            } else if (matches(t.where, payload)) {
                this.counts[a.id] = (this.counts[a.id] ?? 0) + 1;
                this.dirty = true;
                if (this.counts[a.id] >= t.threshold) {
                    earnedNow = this.earn(a) || earnedNow;
                }
            }
        }
        if (earnedNow || event === 'runComplete') {
            this.flush();
            this.persist();
        }
    }

    /** @returns {boolean} true only the first time this achievement is earned */
    earn(a) {
        if (this.earned.has(a.id)) {
            return false;
        }
        this.earned.add(a.id);
        this.dirty = true;
        return true;
    }

    resolveSteam() {
        try {
            return (typeof this.steam === 'function' ? this.steam() : this.steam) ?? null;
        } catch {
            return null;
        }
    }

    /** Sends every earned-but-undelivered achievement to Steam. A no-op while Steam is absent. */
    flush() {
        const steam = this.resolveSteam();
        if (!steam) {
            return;
        }
        for (const a of this.achievements) {
            if (this.earned.has(a.id) && !this.delivered.has(a.id) && !this.inflight.has(a.id)) {
                this.deliver(steam, a);
            }
        }
    }

    deliver(steam, a) {
        try {
            const status = steam.getStatus?.();
            if (status && typeof status.then !== 'function' && status.available === false) {
                return; // Steam absent: stay pending
            }
            this.inflight.add(a.id);
            Promise.resolve(steam.unlockAchievement(a.steamApiName)).then((ok) => {
                if (ok === true) {
                    this.delivered.add(a.id);
                    this.dirty = true;
                    this.persist();
                }
            }).catch(() => {}).finally(() => this.inflight.delete(a.id));
        } catch {
            this.inflight.delete(a.id); // never break gameplay
        }
    }

    /** Hands over a Steam service/bridge (late init) and flushes anything pending. */
    attachSteam(steam) {
        this.steam = steam;
        this.flush();
    }

    /** Earned achievements Steam has not accepted yet. */
    get pending() {
        return this.achievements.filter((a) => this.earned.has(a.id) && !this.delivered.has(a.id)).map((a) => a.steamApiName);
    }

    isUnlocked(id) {
        return this.earned.has(id);
    }

    persist() {
        if (!this.dirty) {
            return;
        }
        this.dirty = false;
        this.storage.write(KEY, { unlocked: [...this.earned], delivered: [...this.delivered], counts: this.counts });
    }

    dispose() {
        this.offs.forEach((off) => off());
        this.offs = [];
    }
}
