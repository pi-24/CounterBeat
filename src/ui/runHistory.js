/**
 * runHistory.js - what the menu shows about the player's past runs: the last
 * session and the best rank / accuracy per chart.  Plain data over a Storage
 * ({read, write}); local only, never sent anywhere and never read by ranking.
 * Practice and the tutorial are not recorded.
 */

const KEY = 'runHistory';
export const RANK_ORDER = Object.freeze(['S', 'A', 'B', 'C', 'D', 'E']);

/** @param {string|null|undefined} a @param {string|null|undefined} b @returns {string|null} the better of two ranks */
export function betterRank(a, b) {
    const ia = RANK_ORDER.indexOf(a);
    const ib = RANK_ORDER.indexOf(b);
    if (ia < 0) return ib < 0 ? null : b;
    if (ib < 0) return a;
    return ia <= ib ? a : b;
}

/** @param {{mode?:string, difficulty?:string, kind?:string}} run @returns {boolean} whether this run belongs in the history */
export function isRecordable(run) {
    return Boolean(run) && run.mode !== 'practice' && run.mode !== 'tutorial' && run.difficulty !== 'tutorial' && run.kind !== 'tutorial';
}

const num = (value) => (Number.isFinite(value) ? value : 0);

export class RunHistory {
    /** @param {{read:Function, write:Function}} storage */
    constructor(storage) {
        this.storage = storage;
    }

    /** @returns {{last:object|null, charts:Record<string,{rank:string|null, accuracy:number}>}} */
    data() {
        const raw = this.storage.read(KEY, {});
        const charts = {};
        for (const [id, entry] of Object.entries(raw?.charts ?? {})) {
            charts[id] = {
                rank: RANK_ORDER.includes(entry?.rank) ? entry.rank : null,
                accuracy: Math.min(1, Math.max(0, num(entry?.accuracy))),
            };
        }
        const last = raw?.last && typeof raw.last.chartId === 'string' ? raw.last : null;
        return { last, charts };
    }

    get last() {
        return this.data().last;
    }

    /** @param {string} chartId @returns {string|null} */
    bestRankFor(chartId) {
        return this.data().charts[chartId]?.rank ?? null;
    }

    /** @param {string} chartId @returns {number} 0..1 */
    bestAccuracyFor(chartId) {
        return this.data().charts[chartId]?.accuracy ?? 0;
    }

    /** @returns {string|null} the best rank on any chart */
    bestRank() {
        return Object.values(this.data().charts).reduce((best, c) => betterRank(best, c.rank), null);
    }

    /** @returns {number} the best accuracy on any chart, 0..1 */
    bestAccuracy() {
        return Object.values(this.data().charts).reduce((best, c) => Math.max(best, c.accuracy), 0);
    }

    /**
     * @param {{chartId:string, trackId?:string, trackName?:string, levelName?:string, difficulty?:string, kind?:string, score:number, accuracy:number, rank?:string}} record
     * @param {{mode?:string, at?:number}} [options]
     * @returns {boolean} whether it was recorded
     */
    record(record, options = {}) {
        if (!record || typeof record.chartId !== 'string' || !isRecordable({ ...record, mode: options.mode })) {
            return false;
        }
        const data = this.data();
        const previous = data.charts[record.chartId] ?? { rank: null, accuracy: 0 };
        data.charts[record.chartId] = {
            rank: betterRank(previous.rank, record.rank),
            accuracy: Math.max(previous.accuracy, num(record.accuracy)),
        };
        data.last = {
            chartId: record.chartId,
            trackId: record.trackId ?? null,
            trackName: record.trackName ?? record.levelName ?? record.chartId,
            difficulty: record.difficulty ?? null,
            kind: record.kind ?? null,
            mode: options.mode ?? null,
            score: Math.round(num(record.score)),
            accuracy: num(record.accuracy),
            rank: RANK_ORDER.includes(record.rank) ? record.rank : null,
            at: options.at ?? Date.now(),
        };
        this.storage.write(KEY, data);
        return true;
    }
}
