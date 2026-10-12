/**
 * ScoreRepository.js
 *
 * Owns the `counterbeat:scores` and `counterbeat:logs` entries in local
 * storage.  Every completed run is appended as a JSON record; the rankings
 * page derives each player's top score from this list rather than storing a
 * second, duplicated table.  Replay logs are heavier (a few thousand tick
 * lengths), so only a bounded number are kept: every personal best plus the
 * most recent runs.
 *
 * Record shape (what Scorer.toRecord produces, plus ownership):
 * {
 *   id, userId, displayName, mainGame,
 *   chartId, kind, trackId, trackName, difficulty, levelId (tier), levelName,
 *   score, accuracy, bestCombo, counterStrafes, headshots,
 *   perfect, good, loose, missed, notes, completed, passed, rank,
 *   stats: { buckets, mean, median, hits },
 *   verified, playedAt (ISO 8601)
 * }
 */
import { store } from './Storage.js';

const KEY = 'scores';
const LOG_KEY = 'logs';
const MAX_RECORDS = 500;
const MAX_RECENT_LOGS = 15;

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
     * @param {object} [log] the RunRecorder log, kept for replays
     * @returns {object} the stored record.
     */
    add(run, log) {
        const record = {
            id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            playedAt: new Date().toISOString(),
            ...run,
        };
        const scores = this.all();
        scores.push(record);
        // Keep the store bounded so a long session cannot fill the quota.
        this.saveAll(ScoreRepository.prune(scores, MAX_RECORDS));
        if (log) {
            this.storeLog(record, log);
        }
        return record;
    }

    /**
     * Trims the run list to `limit` without losing progress: every player's
     * best run and first pass on each chart always survive (they decide
     * personal bests and unlocks); the rest is filled with the newest runs.
     * @param {object[]} scores oldest first
     * @param {number} limit
     * @returns {object[]} oldest first
     */
    static prune(scores, limit) {
        if (scores.length <= limit) {
            return scores;
        }
        const keep = new Set();
        const best = new Map();
        const passed = new Map();
        for (const run of scores) {
            const key = `${run.userId}|${run.chartId}`;
            const top = best.get(key);
            if (!top || run.score > top.score) {
                best.set(key, run);
            }
            if (run.passed && !passed.has(key)) {
                passed.set(key, run);
            }
        }
        for (const run of [...best.values(), ...passed.values()]) {
            keep.add(run.id);
        }
        for (let i = scores.length - 1; i >= 0 && keep.size < limit; i -= 1) {
            keep.add(scores[i].id);
        }
        return scores.filter((run) => keep.has(run.id));
    }

    /**
     * Best score, best accuracy and pass state per chart for one player,
     * over every run stored.
     * @param {string} userId
     * @returns {Map<string, object>} chartId -> progress entry
     */
    progress(userId) {
        return ScoreRepository.summarise(this.all().filter((run) => run.userId === userId));
    }

    /**
     * The shape SupabaseBackend's player_progress function returns, built
     * from a list of runs.  Unverified runs only count on custom songs.
     * @param {object[]} runs
     * @returns {Map<string, object>}
     */
    static summarise(runs) {
        const byChart = new Map();
        for (const run of runs) {
            if (run.verified === false && run.kind !== 'custom') {
                continue;
            }
            let entry = byChart.get(run.chartId);
            if (!entry) {
                entry = {
                    chartId: run.chartId, kind: run.kind, trackId: run.trackId, trackName: run.trackName,
                    bestScore: -1, bestAccuracy: 0, maxAccuracy: 0, passed: false, runs: 0, counterStrafes: 0,
                };
                byChart.set(run.chartId, entry);
            }
            if (run.score > entry.bestScore) {
                entry.bestScore = run.score;
                entry.bestAccuracy = run.accuracy ?? 0;
            }
            entry.maxAccuracy = Math.max(entry.maxAccuracy, run.accuracy ?? 0);
            entry.passed = entry.passed || Boolean(run.passed);
            entry.runs += 1;
            entry.counterStrafes += run.counterStrafes ?? 0;
        }
        return byChart;
    }

    /**
     * Keeps the log for this run, then prunes: a log survives while its run
     * is a personal best on its chart or one of the most recent runs.
     * @param {object} record
     * @param {object} log
     */
    storeLog(record, log) {
        const logs = this.storage.read(LOG_KEY, {});
        logs[record.id] = log;
        const runs = this.all();
        const keep = new Set();
        const byChart = new Map();
        for (const run of runs) {
            const key = `${run.userId}|${run.chartId}`;
            const best = byChart.get(key);
            if (!best || run.score > best.score) {
                byChart.set(key, run);
            }
        }
        for (const best of byChart.values()) {
            keep.add(best.id);
        }
        for (const run of runs.slice(-MAX_RECENT_LOGS)) {
            keep.add(run.id);
        }
        for (const id of Object.keys(logs)) {
            if (!keep.has(id)) {
                delete logs[id];
            }
        }
        // Storage.write reports a full quota by returning false rather than
        // throwing: keep just this run's log and try once more.
        if (!this.storage.write(LOG_KEY, logs)) {
            this.storage.write(LOG_KEY, { [record.id]: log });
        }
    }

    /** @returns {Set<string>} ids of the runs that still have a replay log (one read, not one per run). */
    logIds() {
        return new Set(Object.keys(this.storage.read(LOG_KEY, {})));
    }

    /** @param {string} runId @returns {object|null} */
    logFor(runId) {
        const logs = this.storage.read(LOG_KEY, {});
        return logs[runId] ?? null;
    }

    /** @param {string} runId @returns {object|undefined} */
    byId(runId) {
        return this.all().find((run) => run.id === runId);
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
        const logs = this.storage.read(LOG_KEY, {});
        const remaining = new Set(this.all().map((run) => run.id));
        for (const id of Object.keys(logs)) {
            if (!remaining.has(id)) {
                delete logs[id];
            }
        }
        this.storage.write(LOG_KEY, logs);
    }

    /**
     * The single best run for a user, optionally limited to one chart.
     * @param {string} userId
     * @param {string} [chartId]
     */
    personalBest(userId, chartId) {
        const runs = this.forUser(userId)
            .filter((run) => chartId === undefined || run.chartId === chartId);
        return runs.reduce((best, run) => (best === null || run.score > best.score ? run : best), null);
    }

    /**
     * One row per registered player: their highest-scoring ranked run.
     * @param {object[]} users the registered accounts to report on.
     * @param {string} [chartFilter] a chart id, or 'best' for any ranked chart.
     * @returns {object[]}
     */
    leaderboard(users, chartFilter = 'best') {
        const runs = this.all();
        const withLogs = this.logIds();
        const rows = [];

        for (const user of users) {
            const candidates = runs.filter((run) => run.userId === user.id
                && ScoreRepository.isRanked(run)
                && (chartFilter === 'best' || run.chartId === chartFilter));
            if (candidates.length === 0) {
                continue;
            }
            const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
            rows.push({
                runId: best.id,
                userId: user.id,
                displayName: user.displayName,
                mainGame: user.mainGame || '-',
                chartId: best.chartId,
                levelId: best.levelId,
                levelName: best.levelName,
                score: best.score,
                accuracy: best.accuracy,
                bestCombo: best.bestCombo,
                counterStrafes: best.counterStrafes,
                headshots: best.headshots ?? 0,
                playedAt: best.playedAt,
                runs: candidates.length,
                hasReplay: withLogs.has(best.id),
            });
        }
        return rows;
    }

    /** @param {object} run @returns {boolean} whether it belongs on the rankings. */
    static isRanked(run) {
        return run.verified !== false && run.kind !== 'custom' && run.kind !== 'tutorial' && run.levelId > 0;
    }

    /** Summary counters used by the rankings page header. */
    summary(users) {
        const runs = this.all().filter(ScoreRepository.isRanked);
        const totalScore = runs.reduce((sum, run) => sum + run.score, 0);
        const bestRun = runs.reduce((best, run) => (best === null || run.score > best.score ? run : best), null);
        return {
            players: users.length,
            runs: runs.length,
            topScore: bestRun ? bestRun.score : 0,
            topPlayer: bestRun ? bestRun.displayName : '-',
            averageScore: runs.length ? Math.round(totalScore / runs.length) : 0,
        };
    }
}

export const scoreRepository = new ScoreRepository();
