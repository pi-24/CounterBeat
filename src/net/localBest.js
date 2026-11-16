/**
 * Durable local personal bests and pass state for runs that are never ranked
 * (guests; Easy, Normal, Campaign, custom songs). Backed by the Storage layer
 * so a reloaded page still reports them. Keyed per player id.
 */
export class LocalBestStore {
    /** @param {{read:Function, write:Function}} storage @param {string} [owner] */
    constructor(storage, owner = 'guest') {
        this.storage = storage;
        this.key = `localBests:${owner}`;
    }

    /** @returns {Record<string,{best:number, passed:boolean}>} */
    all() {
        const data = this.storage.read(this.key, {});
        return data && typeof data === 'object' ? data : {};
    }

    /** @param {string} chartId */
    bestOf(chartId) {
        return this.all()[chartId]?.best ?? 0;
    }

    /** @param {string} chartId */
    hasPassed(chartId) {
        return Boolean(this.all()[chartId]?.passed);
    }

    /**
     * @param {{chartId:string, score:number, passed?:boolean}} record
     * @returns {{personalBest:boolean}}
     */
    record(record) {
        const data = this.all();
        const entry = data[record.chartId] ?? { best: 0, passed: false };
        const personalBest = record.score > entry.best;
        data[record.chartId] = {
            best: personalBest ? record.score : entry.best,
            passed: entry.passed || Boolean(record.passed),
        };
        this.storage.write(this.key, data);
        return { personalBest };
    }
}
