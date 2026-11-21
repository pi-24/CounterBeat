/**
 * boardRows.js
 *
 * The leaderboard sheet from the results screen (docs/design/ui-direction-c.html, frame 04),
 * reused by rankings.html and the home page so the website and the game show scores the same
 * way: # / PLAYER / SCORE / ACC / CMB, your own row inked with an acid bar, a replay button.
 *
 * The first half is pure (ranking, sorting, filtering, entry building) so it is unit tested
 * without a DOM; the second half only turns entries into the shared `.board__*` markup.
 */
import { formatScore, formatAccuracy, formatRelative, el } from './format.js';

/** Sort keys offered by the rankings page and the stat column each one shows. */
export const SORT_COLUMNS = Object.freeze({
    score: { label: 'CMB', value: (row) => row.bestCombo },
    accuracy: { label: 'CMB', value: (row) => row.bestCombo },
    combo: { label: 'CMB', value: (row) => row.bestCombo },
    counterStrafes: { label: 'CS', value: (row) => row.counterStrafes },
});

/** @param {string} isoDate @returns {number} epoch ms, or +Infinity when unknown */
function playedTime(isoDate) {
    const time = Date.parse(isoDate);
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * Leaderboard order: highest score first; on a tie, whoever set it first.
 * @param {object} a @param {object} b
 */
export function byScore(a, b) {
    return (b.score - a.score) || (playedTime(a.playedAt) - playedTime(b.playedAt));
}

/**
 * Orders the backend rows and stamps each with its leaderboard place (`rank`).
 * @param {object[]} rows
 * @returns {object[]}
 */
export function rankRows(rows) {
    return [...rows].sort(byScore).map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * Re-sorts ranked rows by a column. Every other column falls back to the leaderboard
 * rank, so ties stay stable and the place number never changes.
 * @param {object[]} list rows from rankRows
 * @param {string} key a SORT_COLUMNS key
 */
export function sortRows(list, key) {
    const comparators = {
        score: (a, b) => a.rank - b.rank,
        accuracy: (a, b) => (b.accuracy - a.accuracy) || (a.rank - b.rank),
        combo: (a, b) => (b.bestCombo - a.bestCombo) || (a.rank - b.rank),
        counterStrafes: (a, b) => (b.counterStrafes - a.counterStrafes) || (a.rank - b.rank),
    };
    return [...list].sort(comparators[key] ?? comparators.score);
}

/**
 * Case-insensitive name search; an empty needle keeps everything.
 * @param {object[]} list @param {string} needle
 */
export function filterRows(list, needle) {
    const text = String(needle ?? '').trim().toLowerCase();
    return text ? list.filter((row) => String(row.displayName).toLowerCase().includes(text)) : list;
}

/**
 * One display entry per row: everything the sheet prints, already formatted.
 * @param {object[]} rows ranked rows
 * @param {{currentUserId?: string|null, sortKey?: string, showChart?: boolean}} [options]
 */
export function boardEntries(rows, options = {}) {
    const { currentUserId = null, sortKey = 'score', showChart = false } = options;
    const column = SORT_COLUMNS[sortKey] ?? SORT_COLUMNS.score;
    return rows.map((row) => ({
        pos: row.rank,
        name: String(row.displayName),
        isMe: currentUserId !== null && currentUserId !== undefined && currentUserId === row.userId,
        isTop: row.rank <= 3,
        score: formatScore(row.score),
        accuracy: formatAccuracy(row.accuracy),
        stat: String(column.value(row) ?? 0),
        // Small mono line under the name: which chart the run is on (only when it varies), and when.
        detail: [showChart ? row.levelName : '', row.playedAt ? formatRelative(row.playedAt) : '']
            .filter((part) => part && part !== '-').join(' · '),
        runId: row.runId ?? null,
        hasReplay: Boolean(row.hasReplay && row.runId),
    }));
}

/** @param {string} statLabel the label of the fifth column (CMB or CS) */
export function boardHead(statLabel = 'CMB') {
    const head = el('div', 'board__row board__row--head');
    head.setAttribute('role', 'row');
    for (const [text, cls] of [['#', ''], ['PLAYER', ''], ['SCORE', 'num'], ['ACC', 'num num--acc'], [statLabel, 'num'], ['', '']]) {
        const cell = el('span', cls, text);
        cell.setAttribute('role', 'columnheader');
        head.append(cell);
    }
    return head;
}

/**
 * @param {ReturnType<typeof boardEntries>[number]} entry
 * @returns {HTMLElement}
 */
export function boardRow(entry) {
    const row = el('div', `board__row${entry.isTop ? ' is-top' : ''}${entry.isMe ? ' is-me' : ''}`);
    row.setAttribute('role', 'row');

    const name = el('span', 'name', entry.name);
    if (entry.isMe) {
        name.append(el('small', '', 'YOU'));
    } else if (entry.detail) {
        name.append(el('small', 'name__detail', entry.detail));
    }
    name.title = entry.detail ? `${entry.name} · ${entry.detail}` : entry.name;

    let replay;
    if (entry.hasReplay) {
        replay = el('a', 'board__replay');
        replay.href = `game.html?replay=${encodeURIComponent(entry.runId)}`;
        replay.setAttribute('aria-label', `Watch replay: ${entry.name}`);
    } else {
        replay = el('span', 'board__replay is-off');
        replay.setAttribute('aria-hidden', 'true');
    }

    const cells = [el('span', 'pos', String(entry.pos)), name,
        el('span', 'num', entry.score), el('span', 'num num--acc', entry.accuracy), el('span', 'num', entry.stat), replay];
    for (const cell of cells) {
        cell.setAttribute('role', 'cell');
    }
    row.append(...cells);
    return row;
}

/**
 * Fills a sheet body with the header and one row per entry.
 * @param {HTMLElement} host
 * @param {ReturnType<typeof boardEntries>} entries
 * @param {string} [statLabel]
 */
export function renderBoardRows(host, entries, statLabel = 'CMB') {
    host.replaceChildren();
    if (entries.length === 0) {
        return;
    }
    host.append(boardHead(statLabel), ...entries.map(boardRow));
}
