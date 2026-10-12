/**
 * rankings-page.js
 *
 * The leaderboard: one row per player, their best verified run under the
 * current level filter, with client-side sorting and a name search.
 */
import { initNavigation } from '../ui/Navigation.js';
import { TRACKS, DIFFICULTIES, dailyChartId } from '../game/rules/charts.js';
import {
    formatScore, formatAccuracy, formatRelative, statTile, el,
} from '../ui/format.js';

const backend = await initNavigation('rankings');

const levelFilter = document.getElementById('levelFilter');
const sortBy = document.getElementById('sortBy');
const searchPlayer = document.getElementById('searchPlayer');
const refreshBtn = document.getElementById('refreshBtn');
const tableBody = document.getElementById('rankingBody');
const emptyNote = document.getElementById('rankingEmpty');
const caption = document.getElementById('rankingCaption');
const statsHost = document.getElementById('rankingStats');

// One option per track × difficulty, grouped by track.
for (const track of TRACKS) {
    const group = document.createElement('optgroup');
    group.label = `${track.name} · ${track.bpm} BPM`;
    for (const difficulty of DIFFICULTIES) {
        const option = document.createElement('option');
        option.value = `t:${track.id}:${difficulty.id}`;
        option.textContent = `${track.name} · ${difficulty.name}`;
        group.append(option);
    }
    levelFilter.append(group);
}
// A ?chart= link picks the chart; otherwise open on today's daily, where everyone
// plays the same notes and the scores are directly comparable.
const preset = new URLSearchParams(window.location.search).get('chart');
levelFilter.value = preset && [...levelFilter.options].some((option) => option.value === preset)
    ? preset
    : 'daily';

/** @returns {string} the backend filter for the current selection */
function chartFilter() {
    return levelFilter.value === 'daily' ? dailyChartId() : levelFilter.value;
}

/** @returns {string} */
function filterLabel() {
    if (levelFilter.value === 'best') {
        return 'any ranked chart';
    }
    if (levelFilter.value === 'daily') {
        return `today's daily challenge (${dailyChartId().slice(6)})`;
    }
    return levelFilter.selectedOptions[0].textContent;
}

/** @type {object[]} the rows for the current level filter, each with its score `rank` */
let rows = [];
/** Whether the last load failed, so the table can say so instead of "no scores". */
let loadError = false;
/** Bumped on every load so a slow, older request cannot overwrite a newer one. */
let latestRequest = 0;

/** @param {string} isoDate @returns {number} epoch ms, or +Infinity when unknown */
function playedTime(isoDate) {
    const time = Date.parse(isoDate);
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * Leaderboard order: highest score first; on a tie, whoever set it first.
 * @param {object} a @param {object} b
 */
function byScore(a, b) {
    return (b.score - a.score) || (playedTime(a.playedAt) - playedTime(b.playedAt));
}

/** @param {object[]} list @param {string} key */
function sortRows(list, key) {
    // Every other column falls back to the leaderboard rank, so ties stay stable.
    const comparators = {
        score: (a, b) => a.rank - b.rank,
        accuracy: (a, b) => (b.accuracy - a.accuracy) || (a.rank - b.rank),
        combo: (a, b) => (b.bestCombo - a.bestCombo) || (a.rank - b.rank),
        counterStrafes: (a, b) => (b.counterStrafes - a.counterStrafes) || (a.rank - b.rank),
    };
    return [...list].sort(comparators[key] ?? comparators.score);
}

/** The header tiles, for the chart that is selected (not the whole site). */
function renderStats() {
    if (loadError) {
        statsHost.replaceChildren(
            statTile('Players', '-'),
            statTile('Verified runs', '-'),
            statTile('Highest score', '-'),
            statTile('Held by', '-'),
        );
        return;
    }
    const top = rows[0];
    const runs = rows.reduce((sum, row) => sum + (Number(row.runs) || 0), 0);
    statsHost.replaceChildren(
        statTile('Players', String(rows.length)),
        statTile('Verified runs', String(runs)),
        statTile('Highest score', top ? formatScore(top.score) : '-'),
        statTile('Held by', top ? top.displayName : '-'),
    );
}

/**
 * Fills the note under the table.
 * @param {string} text
 * @param {boolean} [withPlayLink] add the "Be the first." link to the game
 */
function setEmptyNote(text, withPlayLink = false) {
    emptyNote.replaceChildren(text);
    if (withPlayLink) {
        const link = el('a', '', 'Be the first.');
        link.href = 'game.html';
        emptyNote.append(' ', link);
    }
}

function renderTable() {
    const currentUser = backend.currentUser();
    const needle = searchPlayer.value.trim().toLowerCase();

    let visible = rows;
    if (needle) {
        visible = visible.filter((row) => row.displayName.toLowerCase().includes(needle));
    }
    visible = sortRows(visible, sortBy.value);

    caption.textContent = `Best verified run per player on ${filterLabel()}`
        + (needle ? `, filtered by "${searchPlayer.value.trim()}"` : '');

    tableBody.replaceChildren();
    emptyNote.hidden = visible.length > 0;
    if (loadError) {
        setEmptyNote("Couldn't load the rankings. Try Refresh.");
    } else if (rows.length === 0) {
        setEmptyNote('No scores yet.', true);
    } else if (visible.length === 0) {
        setEmptyNote(`No players match "${searchPlayer.value.trim()}".`);
    }

    for (const row of visible) {
        const tr = document.createElement('tr');
        const isYou = currentUser && currentUser.id === row.userId;
        if (isYou) {
            tr.className = 'is-you';
        }
        tr.append(
            // The player's place on the leaderboard, whatever the sort or search.
            el('td', `table__rank table__rank--${row.rank}`, String(row.rank)),
            el('td', '', row.displayName + (isYou ? '  (you)' : '')),
            el('td', '', row.mainGame ?? '-'),
            el('td', '', row.levelName),
            el('td', 'table__num', formatScore(row.score)),
            el('td', 'table__num', formatAccuracy(row.accuracy)),
            el('td', 'table__num', String(row.bestCombo)),
            el('td', 'table__num', String(row.counterStrafes)),
            el('td', '', formatRelative(row.playedAt)),
            replayCell(row),
        );
        tableBody.append(tr);
    }
}

/** @param {object} row */
function replayCell(row) {
    const cell = el('td', '');
    if (row.hasReplay && row.runId) {
        const link = el('a', 'table__link', 'Watch');
        link.href = `game.html?replay=${encodeURIComponent(row.runId)}`;
        link.title = `Watch ${row.displayName}'s run`;
        cell.append(link);
    } else {
        cell.textContent = '-';
    }
    return cell;
}

async function load() {
    const request = ++latestRequest;
    caption.textContent = 'Loading…';
    let fetched;
    let failed = false;
    try {
        fetched = await backend.leaderboard(chartFilter());
    } catch (error) {
        console.warn(error);
        failed = true;
    }
    if (request !== latestRequest) {
        return; // the filter changed while this was loading; a newer load owns the table
    }
    loadError = failed;
    rows = failed ? [] : [...fetched].sort(byScore).map((row, index) => ({ ...row, rank: index + 1 }));
    renderStats();
    renderTable();
}

levelFilter.addEventListener('change', load);
sortBy.addEventListener('change', renderTable);
searchPlayer.addEventListener('input', renderTable);
refreshBtn.addEventListener('click', load);

load();
