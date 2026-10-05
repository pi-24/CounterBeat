/**
 * GlobalScoreboard.js
 *
 * A shared rankings table across every browser, for the public deployment.
 * It talks to a Firebase Realtime Database through its plain REST interface
 * - no SDK, just fetch() against `<url>/scores.json` - so the site stays
 * static and the whole feature is one file that does nothing while the URL
 * in siteConfig.js is empty.
 *
 * The local-storage table stays the primary record; this is a mirror of each
 * player's completed runs that other people can see.
 */
import { SITE_CONFIG } from './siteConfig.js';

export class GlobalScoreboard {
    /** @param {string} baseUrl the database root, without a trailing slash. */
    constructor(baseUrl) {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    }

    /** @returns {boolean} whether a database has been configured. */
    get enabled() {
        return this.baseUrl !== '';
    }

    /** @returns {string} */
    get endpoint() {
        return `${this.baseUrl}/scores.json`;
    }

    /**
     * Publishes one completed run.  Failures are logged, never thrown: the
     * run is already safe in local storage.
     * @param {object} run a stored run record, with userId and displayName.
     * @returns {Promise<boolean>} whether the write succeeded.
     */
    async submit(run) {
        if (!this.enabled) {
            return false;
        }
        const payload = {
            userId: run.userId,
            displayName: run.displayName,
            country: run.country ?? '',
            mainGame: run.mainGame ?? '',
            levelId: run.levelId,
            levelName: run.levelName,
            score: run.score,
            accuracy: run.accuracy,
            bestCombo: run.bestCombo,
            counterStrafes: run.counterStrafes,
            headshots: run.headshots ?? 0,
            playedAt: run.playedAt ?? new Date().toISOString(),
        };
        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            return response.ok;
        } catch (error) {
            console.warn('GlobalScoreboard: submit failed', error);
            return false;
        }
    }

    /**
     * Fetches every run and reduces it to one row per player: their best
     * score under the level filter.
     * @param {number|'best'} [levelId]
     * @returns {Promise<object[]>}
     */
    async leaderboard(levelId = 'best') {
        if (!this.enabled) {
            return [];
        }
        const response = await fetch(this.endpoint, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Global scoreboard returned ${response.status}`);
        }
        const data = await response.json();
        const runs = data ? Object.values(data) : [];

        const bestByPlayer = new Map();
        for (const run of runs) {
            if (!run || typeof run.score !== 'number' || !run.userId) {
                continue;
            }
            if (run.levelId <= 0 || (levelId !== 'best' && run.levelId !== Number(levelId))) {
                continue;
            }
            const current = bestByPlayer.get(run.userId);
            if (!current || run.score > current.score) {
                bestByPlayer.set(run.userId, run);
            }
        }

        return [...bestByPlayer.values()].map((run) => ({
            userId: run.userId,
            displayName: String(run.displayName ?? 'Player').slice(0, 20),
            country: run.country || '—',
            mainGame: run.mainGame || '—',
            levelId: run.levelId,
            levelName: run.levelName,
            score: run.score,
            accuracy: run.accuracy ?? 0,
            bestCombo: run.bestCombo ?? 0,
            counterStrafes: run.counterStrafes ?? 0,
            playedAt: run.playedAt,
        }));
    }
}

export const globalScoreboard = new GlobalScoreboard(SITE_CONFIG.globalScoreboardUrl);
