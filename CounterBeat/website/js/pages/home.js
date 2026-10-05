/**
 * home.js
 *
 * The home page: navigation plus the small "live leaders" panel, which reads
 * the same leaderboard data the rankings page uses.
 */
import { initNavigation } from '../ui/Navigation.js';
import { userRepository } from '../core/UserRepository.js';
import { scoreRepository } from '../core/ScoreRepository.js';
import { formatScore, formatAccuracy, el } from '../ui/format.js';

initNavigation('index');

/** Renders the top three scores into the home page card. */
function renderLeaders() {
    const host = document.getElementById('homeLeaders');
    if (!host) {
        return;
    }

    const rows = scoreRepository
        .leaderboard(userRepository.all(), 'best')
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    host.replaceChildren();

    if (rows.length === 0) {
        const empty = el('p', 'text-dim', 'No scores yet — the board is wide open.');
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
    link.href = 'rankings.html';
    host.append(list, link);
}

renderLeaders();
