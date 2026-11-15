/**
 * failout.js
 *
 * Whether Focus reaching 0 ends a run, by mode and difficulty (D1).  The
 * table is data/rules.json (difficulties.<id>.failOut), so the client, the
 * simulator and the edge function all ask the same question.
 *
 * Campaign never fails out.  Easy and Normal never fail out anywhere.  Hard
 * and Expert fail out in Quick Play, Daily and Ranked.
 */
import { RULES } from './rules.js';

/** Modes the fail-out table knows about. */
export const FAIL_MODES = Object.freeze(['campaign', 'quickPlay', 'daily', 'ranked']);

/**
 * @param {string} mode one of FAIL_MODES (anything else is treated as quickPlay)
 * @param {string} difficultyId
 * @returns {boolean} true when Focus 0 ends the run
 */
export function failsOut(mode, difficultyId) {
    if (mode === 'campaign') {
        return false;
    }
    // An unknown difficulty or a row without a table is the strict case.
    const table = (RULES.difficulties[difficultyId] ?? RULES.difficulties.hard)?.failOut;
    const key = FAIL_MODES.includes(mode) ? mode : 'quickPlay';
    return table?.[key] === true;
}

/**
 * The mode a chart is played in when nothing says otherwise: daily charts are
 * daily, everything else is Quick Play.
 * @param {{kind?: string}} level
 */
export function modeForLevel(level) {
    return level?.kind === 'daily' ? 'daily' : 'quickPlay';
}

/**
 * Can this run end in a fail-out?  The tutorial never can.
 * @param {object} level a chart definition
 * @param {string} [mode] overrides the level's own mode
 */
export function canFailOut(level, mode) {
    if (!level || level.tutorial) {
        return false;
    }
    return failsOut(mode ?? modeForLevel(level), level.difficulty?.id);
}

/**
 * Fail-out for playing back a saved log.  Logs from before version 6 carry no
 * mode and were recorded when every chart but the tutorial failed out, so they
 * keep that rule and replay to the same end.
 * @param {object} level a chart definition
 * @param {{version?: number, mode?: string}|null} log the replayed log, if any
 * @param {string} mode the mode the screen is running in
 */
export function replayCanFailOut(level, log, mode) {
    if (log && log.version < 6) {
        return Boolean(level) && !level.tutorial;
    }
    return canFailOut(level, log?.mode ?? mode);
}
