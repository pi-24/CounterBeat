/**
 * ScoreRepository.js
 *
 * Owns the `counterbeat:scores` entry in local storage.  Every completed run
 * is appended as a JSON record; the rankings page derives each player's top
 * score from this list rather than storing a second, duplicated table.
 *
 * Record shape:
 * {
 *   id: string,
 *   userId: string,
 *   displayName: string,       // denormalised so guests can still be listed
 *   country: string,
 *   levelId: number,
 *   levelName: string,
 *   score: number,
 *   accuracy: number,          // 0..1
 *   bestCombo: number,
 *   counterStrafes: number,
 *   perfect: number,
 *   good: number,
 *   loose: number,
 *   missed: number,
 *   completed: boolean,
 *   playedAt: string           // ISO 8601
 * }
 */
import { store } from './Storage.js';

const KEY = 'scores';
const MAX_RECORDS = 500;

export class ScoreRepository {
    /** @param {import('./Storage.js').Storage} storage */
    constructor(storage = store) {
        this.storage = storage;
    }

    /** @returns {object[]} */
    all() {
        const scores = this.storage.read(KEY, []);
        return Array.isArray(scores) ? scores : [];
    }

    /** @param {object[]} scores */
    saveAll(scores) {
        return this.storage.write(KEY, scores);
    }

    /**
     * Appends a run.
     * @param {object} run
     * @returns {object} the stored record.
     */
    add(run) {
        const record = {
            id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            playedAt: new Date().toISOString(),
            ...run,
        };
        const scores = this.all();
        scores.push(record);
        // Keep the store bounded so a long session cannot fill the quota.
        this.saveAll(scores.slice(-MAX_RECORDS));
        return record;
    }

    /** @param {string} userId */
    forUser(userId) {
        return this.all()
            .filter((run) => run.userId === userId)
            .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
    }

    /** @param {string} userId */
    removeForUser(userId) {
        this.saveAll(this.all().filter((run) => run.userId !== userId));
    }

    /**
     * The single best run for a user, optionally limited to one level.
     * @param {string} userId
     * @param {number} [levelId]
     */
    personalBest(userId, levelId) {
        const runs = this.forUser(userId)
            .filter((run) => levelId === undefined || run.levelId === levelId);
        return runs.reduce((best, run) => (best === null || run.score > best.score ? run : best), null);
    }

    /**
     * One row per registered player: their highest-scoring run.
     * @param {object[]} users the registered accounts to report on.
     * @param {number|'best'} [levelId] filter, or 'best' for any level.
     * @returns {object[]}
     */
    leaderboard(users, levelId = 'best') {
        const runs = this.all();
        const rows = [];

        for (const user of users) {
            const candidates = runs.filter((run) => run.userId === user.id
                && run.levelId > 0
                && (levelId === 'best' || run.levelId === Number(levelId)));
            if (candidates.length === 0) {
                continue;
            }
            const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
            rows.push({
                userId: user.id,
                displayName: user.displayName,
                country: user.country || '—',
                mainGame: user.mainGame || '—',
                levelId: best.levelId,
                levelName: best.levelName,
                score: best.score,
                accuracy: best.accuracy,
                bestCombo: best.bestCombo,
                counterStrafes: best.counterStrafes,
                playedAt: best.playedAt,
                runs: candidates.length,
            });
        }
        return rows;
    }

    /** Summary counters used by the rankings page header. */
    summary(users) {
        const runs = this.all();
        const totalScore = runs.reduce((sum, run) => sum + run.score, 0);
        const bestRun = runs.reduce((best, run) => (best === null || run.score > best.score ? run : best), null);
        return {
            players: users.length,
            runs: runs.length,
            topScore: bestRun ? bestRun.score : 0,
            topPlayer: bestRun ? bestRun.displayName : '—',
            averageScore: runs.length ? Math.round(totalScore / runs.length) : 0,
        };
    }
}

export const scoreRepository = new ScoreRepository();
