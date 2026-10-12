/**
 * home.js
 *
 * The home page: navigation plus the small "live leaders" panel, which reads
 * the same leaderboard data the rankings page uses.  Scores are only
 * comparable on the same chart, so the panel shows one chart at a time.
 */
import { initNavigation } from '../ui/Navigation.js';
import { TRACKS, DIFFICULTIES, dailyChartId } from '../game/rules/charts.js';
import { formatScore, formatAccuracy, el } from '../ui/format.js';

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
        rows = (await backend.leaderboard(chartFilter())).sort((a, b) => b.score - a.score).slice(0, 5);
    } catch (error) {
        console.warn(error);
        if (request === latestRequest) {
            host.replaceChildren(el('p', 'text-dim', "Couldn't load scores right now."));
        }
        return;
    }
    if (request !== latestRequest) {
        return;
    }

    host.replaceChildren();

    if (rows.length === 0) {
        const empty = el('p', 'text-dim', 'No scores on this chart yet. The board is wide open.');
        const link = el('a', '', 'Play the first run →');
        link.href = 'game.html';
        host.append(empty, link);
        return;
    }

    const list = el('ul', 'rail__list');
    rows.forEach((row, index) => {
        const item = document.createElement('li');
        const left = el('span', '', `${index + 1}. ${row.displayName}`);
        const right = el('span', 'mono', `${formatScore(row.score)}  ·  ${formatAccuracy(row.accuracy)}`);
        item.append(left, right);
        list.append(item);
    });

    const link = el('a', '', 'Full rankings →');
    link.href = `rankings.html?chart=${encodeURIComponent(chartSelect.value)}`;
    host.append(list, link);
}

chartSelect.addEventListener('change', renderLeaders);
renderLeaders();
