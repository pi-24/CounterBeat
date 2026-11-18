/**
 * leaderboardModel.js - pure view model for the results-screen leaderboard (Direction C, frame 04).
 * Rows come from backend.leaderboard(); this ranks them, keeps the top few, and pins the player's own
 * row in context (the players directly above and below) when they are further down.
 */

export const BOARD_TABS = Object.freeze([
    { id: 'global', label: 'Global' },
    { id: 'friends', label: 'Friends' },
    { id: 'daily', label: 'Daily' },
]);

/** Empty-state copy per tab, so a blank board always says why. */
export const BOARD_EMPTY = Object.freeze({
    global: 'No verified runs on this chart yet. Hard and Expert runs are ranked.',
    friends: 'Friends boards arrive with the Steam build. Global and Daily are live.',
    daily: 'No runs on today\'s daily yet.',
});

/** Percentage string such as "97.18%". @param {number} fraction */
export function percentText(fraction) {
    return `${((Number(fraction) || 0) * 100).toFixed(2)}%`;
}

/**
 * @param {object[]} rows leaderboard rows ({userId, displayName, score, accuracy, bestCombo, runId, hasReplay})
 * @param {{userId?:string|null, top?:number, around?:number}} [options]
 * @returns {{total:number, entries:object[], me:object|null, topPercent:string}}
 */
export function buildBoardView(rows, { userId = null, top = 5, around = 1 } = {}) {
    const ranked = [...(rows ?? [])]
        .sort((a, b) => (b.score - a.score) || String(a.displayName).localeCompare(String(b.displayName)))
        .map((row, index) => ({
            pos: index + 1,
            name: row.displayName ?? 'Player',
            score: row.score,
            accuracy: percentText(row.accuracy),
            combo: row.bestCombo ?? 0,
            runId: row.runId ?? null,
            hasReplay: Boolean(row.hasReplay),
            isMe: userId !== null && row.userId === userId,
            top: false,
        }));
    for (const entry of ranked.slice(0, 3)) {
        entry.top = true;
    }
    const total = ranked.length;
    const me = ranked.find((entry) => entry.isMe) ?? null;
    const keep = new Set(ranked.slice(0, top).map((entry) => entry.pos));
    if (me) {
        for (let p = me.pos - around; p <= me.pos + around; p += 1) {
            if (p >= 1 && p <= total) {
                keep.add(p);
            }
        }
    }
    const entries = [];
    let previous = 0;
    for (const entry of ranked) {
        if (!keep.has(entry.pos)) {
            continue;
        }
        if (previous && entry.pos > previous + 1) {
            entries.push({ gap: true });
        }
        entries.push(entry);
        previous = entry.pos;
    }
    return {
        total,
        entries,
        me,
        topPercent: me && total > 0 ? `YOU: ${me.pos} OF ${total}` : '',
    };
}
