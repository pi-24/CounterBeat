/**
 * stars.js
 *
 * Pure star calculator (GDD section 4). Three stars per chart:
 *   1. pass       - accuracy >= the difficulty's passAccuracy (Easy: just finish)
 *   2. rank       - accuracy >= grading.rankAccuracy (85%, i.e. rank S or A)
 *   3. challenge  - no misses, or >= 80% of shots on a Perfect/Good stop
 * Campaign awards stars on Easy/Normal/Hard; Quick Play does the same at full
 * speed only. Expert, Practice, Daily, Ranked and Custom award none.
 *
 * Star data is local/synced progression only: the ranked submit path and the
 * edge function never read it (see README, "Stars and tampering").
 */
import { RULES, RANK_A_ACCURACY, gradeStop } from '../rules/rules.js';
import { TRACKS } from '../rules/charts.js';

/** Track ids that can carry campaign stars (the 6 official tracks). */
export const CAMPAIGN_TRACK_IDS = Object.freeze(TRACKS.map((t) => t.id));

export const STAR_DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);
export const STARS_PER_CHART = 3;
export const STAR_MODES = Object.freeze(['campaign', 'quickPlay']);

/**
 * @param {{mode:string, difficulty:string, speed?:number, completed?:boolean}} run
 * @returns {boolean} whether this run can award stars at all.
 */
export function awardsStars({ mode, difficulty, speed = 1, completed = true }) {
    if (completed === false || !STAR_DIFFICULTIES.includes(difficulty)) {
        return false;
    }
    if (mode === 'campaign') {
        return true;
    }
    return mode === 'quickPlay' && speed >= 1;
}

/**
 * @param {{accuracy:number, difficulty:string, missed:number, notes?:number,
 *   stopShots?:number, stopGood?:number, completed?:boolean}} result
 *   stopShots = shots fired at a note; stopGood = those fired on a Perfect/Good stop
 * @returns {[boolean, boolean, boolean]} [pass, rank, challenge]
 */
export function calculateStars(result) {
    const cfg = RULES.stars;
    const rules = RULES.difficulties[result.difficulty];
    if (!rules || result.completed === false || !STAR_DIFFICULTIES.includes(result.difficulty)) {
        return [false, false, false];
    }
    const accuracy = result.accuracy;
    const pass = result.difficulty === 'easy' ? true : accuracy >= rules.passAccuracy;
    const rank = accuracy >= RANK_A_ACCURACY;
    const noMiss = cfg.challengeNoMiss && result.missed === 0 && (result.notes ?? 1) > 0;
    // Stop quality is judged on shots fired, by the stop grade alone (timing is
    // ignored), so loose timing with clean stops still earns the challenge.
    const shots = result.stopShots ?? 0;
    const quality = shots > 0 && (result.stopGood ?? 0) / shots >= cfg.challengeStopQuality;
    return [pass, rank, noMiss || quality];
}

/** Counts, per run, how many shots were fired on a Perfect or Good stop. */
export class StopQuality {
    constructor() {
        this.stopShots = 0;
        this.stopGood = 0;
    }

    /** @param {number} speed player speed (units/s) at the moment of the shot */
    add(speed) {
        this.stopShots += 1;
        const grade = gradeStop(speed);
        if (grade === 'perfect' || grade === 'good') {
            this.stopGood += 1;
        }
    }
}

/** @param {boolean[]} flags @returns {number} */
export function countStars(flags) {
    return flags.filter(Boolean).length;
}

/** @returns {string} progress key for one chart slot */
export function chartKey(trackId, difficulty) {
    return `${trackId}:${difficulty}`;
}

/**
 * Sums the best stars per chart slot. Slots outside the campaign tracks, the 3 star difficulties
 * or beyond 3 flags are ignored, so a slot can never exceed 3 stars.
 * @param {Record<string, boolean[]>} best
 */
export function totalStars(best) {
    let total = 0;
    for (const [key, flags] of Object.entries(best ?? {})) {
        const [trackId, difficulty] = key.split(':');
        if (CAMPAIGN_TRACK_IDS.includes(trackId) && STAR_DIFFICULTIES.includes(difficulty) && Array.isArray(flags)) {
            total += countStars(flags.slice(0, STARS_PER_CHART));
        }
    }
    return total;
}

/** Union of two best-star maps; used for local + remote sync. */
export function mergeBest(a = {}, b = {}) {
    const out = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        out[key] = [0, 1, 2].map((i) => Boolean(a[key]?.[i]) || Boolean(b[key]?.[i]));
    }
    return out;
}
