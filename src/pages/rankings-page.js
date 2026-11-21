/**
 * rankings-page.js
 *
 * The leaderboard: one row per player, their best verified run under the
 * current level filter, with client-side sorting and a name search.  The rows
 * are the results-screen sheet from the game (src/ui/boardRows.js).
 */
import { initNavigation } from '../ui/Navigation.js';
import { TRACKS, DIFFICULTIES, dailyChartId } from '../game/rules/charts.js';
import { formatScore, statTile, el } from '../ui/format.js';
import {
    rankRows, sortRows, filterRows, boardEntries, renderBoardRows, SORT_COLUMNS,
} from '../ui/boardRows.js';

const backend = await initNavigation('rankings');

const levelFilter = document.getElementById('levelFilter');
const sortBy = document.getElementById('sortBy');
const searchPlayer = document.getElementById('searchPlayer');
const refreshBtn = document.getElementById('refreshBtn');
const boardRowsHost = document.getElementById('rankingBody');
const tabButtons = [...document.querySelectorAll('[data-board-tab]')];
const metaCaption = document.getElementById('rankingMeta');
const metaCount = document.getElementById('rankingCount');
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

/** Marks the sheet tab that matches the chart select: Daily, Best, or a specific chart. */
function syncTabs() {
    const active = levelFilter.value === 'daily' || levelFilter.value === 'best' ? levelFilter.value : 'chart';
    for (const button of tabButtons) {
        const on = button.dataset.boardTab === active;
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-selected', String(on));
    }
}

function renderTable() {
    const currentUser = backend.currentUser();
    const needle = searchPlayer.value.trim();
    const visible = sortRows(filterRows(rows, needle), sortBy.value);
    const statLabel = (SORT_COLUMNS[sortBy.value] ?? SORT_COLUMNS.score).label;

    caption.textContent = `Best verified run per player on ${filterLabel()}`
        + (needle ? `, filtered by "${needle}"` : '');
    metaCaption.textContent = filterLabel().toUpperCase();
    metaCount.textContent = loadError ? '' : `${rows.length} ${rows.length === 1 ? 'PLAYER' : 'PLAYERS'}`;
    syncTabs();

    emptyNote.hidden = visible.length > 0;
    if (loadError) {
        setEmptyNote("Couldn't load the rankings. Try Refresh.");
    } else if (rows.length === 0) {
        setEmptyNote('No scores yet.', true);
    } else if (visible.length === 0) {
        setEmptyNote(`No players match "${needle}".`);
    }

    // The place number is the player's leaderboard rank, whatever the sort or search.
    const entries = boardEntries(visible, {
        currentUserId: currentUser ? currentUser.id : null,
        sortKey: sortBy.value,
        showChart: levelFilter.value === 'best',
    });
    renderBoardRows(boardRowsHost, entries, statLabel);
}

async function load() {
    const request = ++latestRequest;
    caption.textContent = 'Loading…';
    metaCaption.textContent = 'LOADING…';
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
    rows = failed ? [] : rankRows(fetched);
    renderStats();
    renderTable();
}

levelFilter.addEventListener('change', load);
for (const button of tabButtons) {
    button.addEventListener('click', () => {
        const tab = button.dataset.boardTab;
        if (tab === 'chart') {
            // Hand over to the chart select: it is the only place a specific chart is picked.
            if (levelFilter.value === 'daily' || levelFilter.value === 'best') {
                levelFilter.value = 't:neon:hard';
                load();
            }
            levelFilter.focus();
            return;
        }
        if (levelFilter.value !== tab) {
            levelFilter.value = tab;
            load();
        }
    });
}
sortBy.addEventListener('change', renderTable);
searchPlayer.addEventListener('input', renderTable);
refreshBtn.addEventListener('click', load);

load();
