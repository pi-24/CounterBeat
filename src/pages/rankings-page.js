/**
 * rankings-page.js
 *
 * The leaderboard: one row per player, their best verified run under the
 * current level filter, with client-side sorting and a name search.
 */
import { initNavigation } from '../ui/Navigation.js';
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

const LEVEL_LABEL = {
    best: 'any level',
    1: 'Level 1 — The Range',
    2: 'Level 2 — Neon Alley',
    3: 'Level 3 — Server Vault',
};

/** @type {object[]} the rows for the current level filter */
let rows = [];

/** @param {object[]} list @param {string} key */
function sortRows(list, key) {
    const comparators = {
        score: (a, b) => b.score - a.score,
        accuracy: (a, b) => b.accuracy - a.accuracy,
        combo: (a, b) => b.bestCombo - a.bestCombo,
        counterStrafes: (a, b) => b.counterStrafes - a.counterStrafes,
    };
    return [...list].sort(comparators[key] ?? comparators.score);
}

async function renderStats() {
    try {
        const summary = await backend.summary();
        statsHost.replaceChildren(
            statTile('Players', String(summary.players)),
            statTile('Verified runs', String(summary.runs)),
            statTile('Highest score', formatScore(summary.topScore)),
            statTile('Held by', summary.topPlayer),
        );
    } catch (error) {
        console.warn(error);
    }
}

function renderTable() {
    const currentUser = backend.currentUser();
    const level = levelFilter.value;
    const needle = searchPlayer.value.trim().toLowerCase();

    let visible = rows;
    if (needle) {
        visible = visible.filter((row) => row.displayName.toLowerCase().includes(needle));
    }
    visible = sortRows(visible, sortBy.value);

    caption.textContent = `Best verified run per player on ${LEVEL_LABEL[level]}`
        + (needle ? `, filtered by "${searchPlayer.value.trim()}"` : '');

    tableBody.replaceChildren();
    emptyNote.hidden = visible.length > 0;

    visible.forEach((row, index) => {
        const tr = document.createElement('tr');
        const isYou = currentUser && currentUser.id === row.userId;
        if (isYou) {
            tr.className = 'is-you';
        }
        tr.append(
            el('td', `table__rank table__rank--${index + 1}`, String(index + 1)),
            el('td', '', row.displayName + (isYou ? '  (you)' : '')),
            el('td', '', row.mainGame ?? '—'),
            el('td', '', `${row.levelId}. ${row.levelName}`),
            el('td', 'table__num', formatScore(row.score)),
            el('td', 'table__num', formatAccuracy(row.accuracy)),
            el('td', 'table__num', String(row.bestCombo)),
            el('td', 'table__num', String(row.counterStrafes)),
            el('td', '', formatRelative(row.playedAt)),
        );
        tableBody.append(tr);
    });
}

async function load() {
    caption.textContent = 'Loading…';
    try {
        rows = await backend.leaderboard(levelFilter.value);
    } catch (error) {
        console.warn(error);
        rows = [];
    }
    renderTable();
}

levelFilter.addEventListener('change', load);
sortBy.addEventListener('change', renderTable);
searchPlayer.addEventListener('input', renderTable);
refreshBtn.addEventListener('click', () => {
    renderStats();
    load();
});

renderStats();
load();
