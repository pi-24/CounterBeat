/**
 * Ranked submission gate (AC12) and leaderboard chart-version filter (AC14).
 *
 * Pure and dependency-free so the client, the local backend and the
 * submit-run edge function (which uses a byte-identical copy in
 * supabase/functions/_shared/net, kept by `npm run sync-rules`) all apply
 * the same rule: only full-speed HARD and EXPERT runs, on generated or
 * authored charts, reach the ranked leaderboards. Easy and Normal keep a
 * local personal best only.
 */

/** Difficulties that may be ranked (lower-case ids, as in rules.json). */
export const RANKED_DIFFICULTIES = Object.freeze(['hard', 'expert']);

/** Run modes that may be submitted (Campaign and Practice never are). */
export const SUBMITTABLE_MODES = Object.freeze(['daily', 'ranked', 'quickPlay']);

/**
 * @param {{chartId?: string, kind?: string, custom?: boolean, difficulty?: string,
 *   mode?: string, speed?: number}} run `difficulty` may be omitted when the
 *   chart id (t:<track>:<difficulty>) names it; a daily chart is always rankable (Hard rules).
 * @returns {{ok: boolean, reason?: string}}
 */
export function canSubmitRankedRun(run) {
    if (!run || typeof run !== 'object') return { ok: false, reason: 'no run' };
    const id = typeof run.chartId === 'string' ? run.chartId : '';
    if (run.kind === 'custom' || run.custom === true || id.startsWith('custom:')) {
        return { ok: false, reason: 'custom songs are unranked (beta)' };
    }
    if (run.kind === 'tutorial' || id === 'tutorial') {
        return { ok: false, reason: 'the tutorial is not ranked' };
    }
    if (run.mode !== undefined && !SUBMITTABLE_MODES.includes(run.mode)) {
        return { ok: false, reason: 'this mode is not ranked' };
    }
    if (run.speed !== undefined && run.speed !== 1) {
        return { ok: false, reason: 'only full-speed runs are ranked' };
    }
    const parts = id.split(':');
    const isDaily = parts[0] === 'daily' && parts.length === 2;
    const isTrack = parts[0] === 't' && parts.length === 3;
    if (!isDaily && !isTrack) {
        return { ok: false, reason: 'unknown chart' };
    }
    // The Daily is its own seeded challenge played under Hard rules (fail-out
    // included), whatever density its seed rolled, so it is always rankable.
    if (isDaily) {
        return { ok: true };
    }
    const difficulty = String(run.difficulty ?? parts[2]).toLowerCase();
    if (run.difficulty !== undefined && String(run.difficulty).toLowerCase() !== parts[2]) {
        return { ok: false, reason: 'difficulty does not match chart' };
    }
    if (!RANKED_DIFFICULTIES.includes(difficulty)) {
        return { ok: false, reason: 'only Hard and Expert are ranked; Easy and Normal keep a local best' };
    }
    return { ok: true };
}

/**
 * Sends a run to the ranked backend only if the gate allows it; otherwise
 * the caller keeps the local personal best.
 * @param {{submitRun: Function}} backend
 * @param {object} record
 * @param {object} log
 * @param {string|null} [token]
 * @returns {Promise<object>} the backend's result, or `{saved:false, ranked:false, localOnly:true, reason}`.
 */
export async function submitIfRanked(backend, record, log, token = null) {
    const gate = canSubmitRankedRun({
        chartId: record?.chartId, kind: record?.kind, difficulty: record?.difficulty, mode: log?.mode, speed: log?.speed,
    });
    if (!gate.ok) {
        return { saved: false, accepted: false, ranked: false, localOnly: true, reason: gate.reason,
            score: record?.score, personalBest: false };
    }
    return backend.submitRun(record, log, token);
}

/**
 * Version of a chart a score was set on; unversioned (generated) charts are 0.
 * @param {{chartVersion?: number}} row
 */
export function rowVersion(row) {
    return Number.isInteger(row?.chartVersion) ? row.chartVersion : 0;
}

/**
 * Hides leaderboard rows set on an older chart version.
 * @param {object[]} rows rows with chartId and chartVersion
 * @param {Record<string, number>} currentVersions chartId -> active version (missing = 0)
 * @returns {object[]}
 */
export function filterCurrentVersion(rows, currentVersions) {
    return rows.filter((row) => rowVersion(row) === (currentVersions[row.chartId] ?? 0));
}
