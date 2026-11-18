/**
 * home.js
 *
 * The home page: navigation plus the small "live leaders" panel, which reads
 * the same leaderboard data the rankings page uses.  Scores are only
 * comparable on the same chart, so the panel shows one chart at a time.
 */
import { isDesktop } from '../platform/platform.js';
import { initNavigation } from '../ui/Navigation.js';
import { bindPlayLinks } from './playLauncher.js';
import { TRACKS, DIFFICULTIES, dailyChartId } from '../game/rules/charts.js';
import { el } from '../ui/format.js';
import { coverSvg } from '../ui/trackCovers.js';
import { rankRows, boardEntries, renderBoardRows } from '../ui/boardRows.js';

// The desktop app has no home page: go straight into the game.
if (isDesktop()) {
    window.location.replace('game.html');
}

bindPlayLinks();

// Track covers are the same geometric SVGs as the game's song select.
for (const slot of document.querySelectorAll('[data-cover]')) {
    slot.innerHTML = coverSvg(slot.dataset.cover);
}
const backend = await initNavigation('index');

const chartSelect = document.getElementById('homeChart');

// Same options as the rankings filter: today's daily, then every track × difficulty.
for (const track of TRACKS) {
    const group = document.createElement('optgroup');
    group.label = `${track.name} · ${track.bpm} BPM`;
    for (const difficulty of DIFFICULTIES) {
        const option = document.createElement('option');
        option.value = `t:${track.id}:${difficulty.id}`;
        option.textContent = `${track.name} · ${difficulty.name}`;
        group.append(option);
    }
    chartSelect.append(group);
}

/** @returns {string} the backend filter for the current selection */
function chartFilter() {
    return chartSelect.value === 'daily' ? dailyChartId() : chartSelect.value;
}

/** Bumped on every render so a slow, older request cannot overwrite a newer one. */
let latestRequest = 0;

/** Renders the top five scores on the selected chart into the home page card. */
async function renderLeaders() {
    const host = document.getElementById('homeLeaders');
    if (!host) {
        return;
    }
    const request = ++latestRequest;

    let rows;
    try {
        rows = rankRows(await backend.leaderboard(chartFilter())).slice(0, 5);
    } catch (error) {
        console.warn(error);
        if (request === latestRequest) {
            host.replaceChildren(el('p', 'board__empty', "Couldn't load scores right now."));
        }
        return;
    }
    if (request !== latestRequest) {
        return;
    }

    host.replaceChildren();

    if (rows.length === 0) {
        const empty = el('p', 'board__empty', 'No scores on this chart yet. The board is wide open. ');
        const link = el('a', '', 'Play the first run →');
        link.href = 'game.html';
        empty.append(link);
        host.append(empty);
        return;
    }

    const currentUser = backend.currentUser();
    const rowsHost = el('div', 'board__rows');
    renderBoardRows(rowsHost, boardEntries(rows, { currentUserId: currentUser ? currentUser.id : null }));
    host.append(rowsHost);

    const link = el('a', 'board__more', 'Full rankings →');
    link.href = `rankings.html?chart=${encodeURIComponent(chartSelect.value)}`;
    host.append(link);
}

chartSelect.addEventListener('change', renderLeaders);
renderLeaders();
