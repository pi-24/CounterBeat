/**
 * rankings-page.js
 *
 * Builds the rankings table from local storage.  One row per registered
 * player, showing their best run under the current filter, with client-side
 * sorting and a name search.
 */
import { initNavigation } from '../ui/Navigation.js';
import { userRepository } from '../core/UserRepository.js';
import { scoreRepository } from '../core/ScoreRepository.js';
import { auth } from '../core/AuthService.js';
import {
    formatScore, formatAccuracy, formatRelative, statTile, el,
} from '../ui/format.js';

initNavigation('rankings');

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
    1: 'Level 1 — Warehouse',
    2: 'Level 2 — Neon Alley',
    3: 'Level 3 — Server Vault',
};

/** @param {object[]} rows @param {string} key */
function sortRows(rows, key) {
    const comparators = {
        score: (a, b) => b.score - a.score,
        accuracy: (a, b) => b.accuracy - a.accuracy,
        combo: (a, b) => b.bestCombo - a.bestCombo,
        counterStrafes: (a, b) => b.counterStrafes - a.counterStrafes,
    };
    return [...rows].sort(comparators[key] ?? comparators.score);
}

function renderStats() {
    const users = userRepository.all();
    const summary = scoreRepository.summary(users);

    statsHost.replaceChildren(
        statTile('Registered players', String(summary.players)),
        statTile('Runs recorded', String(summary.runs)),
        statTile('Highest score', formatScore(summary.topScore)),
        statTile('Held by', summary.topPlayer),
        statTile('Average run', formatScore(summary.averageScore)),
    );
}

function renderTable() {
    const currentUser = auth.currentUser();
    const level = levelFilter.value;
    const needle = searchPlayer.value.trim().toLowerCase();

    let rows = scoreRepository.leaderboard(userRepository.all(), level);
    if (needle) {
        rows = rows.filter((row) => row.displayName.toLowerCase().includes(needle));
    }
    rows = sortRows(rows, sortBy.value);

    caption.textContent = `Best run per player on ${LEVEL_LABEL[level]}`
        + (needle ? ` — filtered by "${searchPlayer.value.trim()}"` : '');

    tableBody.replaceChildren();
    emptyNote.hidden = rows.length > 0;

    rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        if (currentUser && currentUser.id === row.userId) {
            tr.className = 'is-you';
        }

        const rank = el('td', `table__rank table__rank--${index + 1}`, String(index + 1));
        const name = el('td', '', row.displayName + (currentUser && currentUser.id === row.userId ? '  (you)' : ''));
        const country = el('td', '', row.country);
        const levelCell = el('td', '', `${row.levelId}. ${row.levelName}`);
        const score = el('td', 'table__num', formatScore(row.score));
        const accuracy = el('td', 'table__num', formatAccuracy(row.accuracy));
        const combo = el('td', 'table__num', String(row.bestCombo));
        const counterStrafes = el('td', 'table__num', String(row.counterStrafes));
        const when = el('td', '', formatRelative(row.playedAt));

        tr.append(rank, name, country, levelCell, score, accuracy, combo, counterStrafes, when);
        tableBody.append(tr);
    });
}

function render() {
    renderStats();
    renderTable();
}

levelFilter.addEventListener('change', renderTable);
sortBy.addEventListener('change', renderTable);
searchPlayer.addEventListener('input', renderTable);
refreshBtn.addEventListener('click', render);

// Another tab finishing a run should be reflected here without a reload.
window.addEventListener('storage', render);

render();
