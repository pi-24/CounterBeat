/**
 * Scorer.js
 *
 * Keeps the running score, the combo, the focus bar and the per-grade tallies
 * for one run, and turns them into the summary record that gets stored.
 */
import {
    BASE_POINTS,
    COMBO_CEILING,
    COMBO_MAX_MULTIPLIER,
    COUNTER_STRAFE_BONUS,
    HEADSHOT_BONUS,
    FOCUS_DELTA,
    FOCUS_MAX,
    GRADE,
} from './config.js';

/** Histogram shape shared by the client and the stats page. */
export const TIMING_BUCKETS = 20;
export const TIMING_RANGE = 0.1;

export class Scorer {
    /** @param {number} totalNotes how many notes the chart contains. */
    constructor(totalNotes) {
        this.totalNotes = totalNotes;
        this.score = 0;
        this.combo = 0;
        this.bestCombo = 0;
        this.focus = FOCUS_MAX;
        this.counterStrafes = 0;
        this.headshots = 0;
        this.wildShots = 0;
        this.judged = 0;
        /** Signed timing error of every hit, seconds (negative = early). */
        this.timingErrors = [];
        this.tally = {
            [GRADE.PERFECT]: 0,
            [GRADE.GOOD]: 0,
            [GRADE.OK]: 0,
            [GRADE.MISS]: 0,
        };
    }

    /** @returns {number} the current combo multiplier. */
    get multiplier() {
        const progress = Math.min(this.combo, COMBO_CEILING) / COMBO_CEILING;
        return 1 + progress * (COMBO_MAX_MULTIPLIER - 1);
    }

    /**
     * Weighted accuracy: a perfect counts fully, a good three quarters, a
     * loose a third.  A plain hit-rate would make a run of scraped notes look
     * identical to a clean one.
     * @returns {number} 0..1
     */
    get accuracy() {
        if (this.judged === 0) {
            return 0;
        }
        const weighted = this.tally[GRADE.PERFECT] * 1
            + this.tally[GRADE.GOOD] * 0.75
            + this.tally[GRADE.OK] * 0.34;
        return Math.max(0, Math.min(1, weighted / this.judged));
    }

    /** @returns {boolean} whether the run has failed. */
    get failed() {
        return this.focus <= 0;
    }

    /**
     * Applies a judgement and returns what it was worth.
     * @param {import('./Judge.js').Judgement} judgement
     * @returns {{ points: number, multiplier: number, bonus: boolean, headshot: boolean }}
     */
    apply(judgement) {
        const grade = judgement.grade;
        this.judged += 1;
        this.tally[grade] += 1;

        if (grade === GRADE.MISS) {
            this.combo = 0;
            this.focus = Math.max(0, this.focus + FOCUS_DELTA.miss);
            return { points: 0, multiplier: 1, bonus: false, headshot: false };
        }

        this.combo += 1;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        if (Number.isFinite(judgement.timingError)) {
            this.timingErrors.push(judgement.timingError);
        }
        this.focus = Math.min(FOCUS_MAX, this.focus + FOCUS_DELTA[grade]);

        const bonus = judgement.counterStrafed;
        if (bonus) {
            this.counterStrafes += 1;
        }
        const headshot = Boolean(judgement.headshot);
        if (headshot) {
            this.headshots += 1;
        }

        const multiplier = this.multiplier
            * (bonus ? COUNTER_STRAFE_BONUS : 1)
            * (headshot ? HEADSHOT_BONUS : 1);
        const points = Math.round(BASE_POINTS[grade] * multiplier);
        this.score += points;

        return { points, multiplier, bonus, headshot };
    }

    /** A shot fired nowhere near a note: small focus penalty, combo break. */
    registerWildShot() {
        this.wildShots += 1;
        this.combo = 0;
        this.focus = Math.max(0, this.focus + FOCUS_DELTA.wildShot);
    }

    /**
     * Builds the record handed back to the page so it can be stored.
     * @param {object} level
     * @param {boolean} completed whether the chart was played to the end.
     */
    toRecord(level, completed) {
        return {
            chartId: level.chartId,
            kind: level.kind,
            trackId: level.trackId,
            trackName: level.trackName,
            difficulty: level.difficulty ? level.difficulty.id : undefined,
            levelId: level.id,
            levelName: level.name,
            stats: this.timingStats(),
            score: this.score,
            accuracy: Number(this.accuracy.toFixed(4)),
            bestCombo: this.bestCombo,
            counterStrafes: this.counterStrafes,
            headshots: this.headshots,
            perfect: this.tally[GRADE.PERFECT],
            good: this.tally[GRADE.GOOD],
            loose: this.tally[GRADE.OK],
            missed: this.tally[GRADE.MISS] + Math.max(0, this.totalNotes - this.judged),
            notes: this.totalNotes,
            completed,
        };
    }

    /**
     * A compact timing profile for the stats page: a histogram of hit errors
     * in 10 ms buckets from -100 to +100 ms, plus the mean and the median.
     * @returns {{buckets:number[], mean:number, median:number, hits:number}}
     */
    timingStats() {
        const buckets = new Array(TIMING_BUCKETS).fill(0);
        const errors = [...this.timingErrors].sort((a, b) => a - b);
        for (const error of errors) {
            const index = Math.floor((error + TIMING_RANGE) / (2 * TIMING_RANGE) * TIMING_BUCKETS);
            buckets[Math.max(0, Math.min(TIMING_BUCKETS - 1, index))] += 1;
        }
        const hits = errors.length;
        const mean = hits ? errors.reduce((sum, e) => sum + e, 0) / hits : 0;
        const median = hits ? errors[Math.floor(hits / 2)] : 0;
        return {
            buckets,
            mean: Math.round(mean * 10000) / 10000,
            median: Math.round(median * 10000) / 10000,
            hits,
        };
    }

    /** @returns {string} a letter grade for the results screen. */
    get rank() {
        const accuracy = this.accuracy;
        if (this.tally[GRADE.MISS] === 0 && accuracy >= 0.97) {
            return 'S';
        }
        if (accuracy >= 0.9) {
            return 'A';
        }
        if (accuracy >= 0.78) {
            return 'B';
        }
        if (accuracy >= 0.62) {
            return 'C';
        }
        if (accuracy >= 0.45) {
            return 'D';
        }
        return 'E';
    }
}
