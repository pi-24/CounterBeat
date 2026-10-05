/**
 * profile-page.js
 *
 * Shows the extra data captured at registration alongside the player's own
 * run history, and lets them clear that history.
 */
import { initNavigation } from '../ui/Navigation.js';
import { auth } from '../core/AuthService.js';
import { scoreRepository } from '../core/ScoreRepository.js';
import { LEVELS } from '../game/levels.js';
import {
    formatScore, formatAccuracy, formatDate, formatRelative, statTile, el,
} from '../ui/format.js';
import { toast } from '../ui/Toast.js';

initNavigation('profile');

const user = auth.currentUser();
const guestNotice = document.getElementById('guestNotice');
const content = document.getElementById('profileContent');

if (!user) {
    guestNotice.hidden = false;
    document.getElementById('profileHeading').textContent = 'Your profile';
    document.getElementById('profileSubtitle').textContent = 'Log in to see the details stored against your account.';
} else {
    content.hidden = false;
    document.getElementById('profileHeading').textContent = user.displayName;
    document.getElementById('profileSubtitle').textContent =
        `Member since ${formatDate(user.createdAt)}.`;

    renderStats();
    renderDetails();
    renderBests();
    renderHistory();

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
        scoreRepository.removeForUser(user.id);
        renderStats();
        renderBests();
        renderHistory();
        toast.info('Run history cleared. Your account details are untouched.');
    });
}

function renderStats() {
    const runs = scoreRepository.forUser(user.id);
    const best = runs.reduce((top, run) => (top === null || run.score > top.score ? run : top), null);
    const totalCounterStrafes = runs.reduce((sum, run) => sum + run.counterStrafes, 0);
    const bestAccuracy = runs.reduce((top, run) => Math.max(top, run.accuracy), 0);

    document.getElementById('profileStats').replaceChildren(
        statTile('Runs played', String(runs.length)),
        statTile('Best score', best ? formatScore(best.score) : '—'),
        statTile('Best accuracy', runs.length ? formatAccuracy(bestAccuracy) : '—'),
        statTile('Counter-strafe bonuses', String(totalCounterStrafes)),
    );
}

function renderDetails() {
    const fields = [
        ['Display name', user.displayName],
        ['Email', user.email],
        ['Country', user.country || '—'],
        ['Phone', user.phone || '—'],
        ['Address', user.address || '—'],
        ['Postcode', user.postcode || '—'],
        ['Preferred difficulty', user.favouriteSensitivity || '—'],
    ];

    const body = document.getElementById('profileDetails');
    body.replaceChildren();

    for (const [label, value] of fields) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = label;
        tr.append(th, el('td', '', value));
        body.append(tr);
    }
}

function renderBests() {
    const host = document.getElementById('profileBests');
    host.replaceChildren();

    const list = el('ul', 'rail__list');
    for (const level of LEVELS) {
        const best = scoreRepository.personalBest(user.id, level.id);
        const item = document.createElement('li');
        item.append(
            el('span', '', `${level.id}. ${level.name}`),
            el('span', 'mono', best
                ? `${formatScore(best.score)}  ·  ${formatAccuracy(best.accuracy)}`
                : 'Not played'),
        );
        list.append(item);
    }
    host.append(list);
}

function renderHistory() {
    const body = document.getElementById('profileHistory');
    const runs = scoreRepository.forUser(user.id).slice(0, 20);
    body.replaceChildren();

    if (runs.length === 0) {
        const tr = document.createElement('tr');
        const td = el('td', 'table__empty', 'No runs yet.');
        td.colSpan = 6;
        tr.append(td);
        body.append(tr);
        return;
    }

    for (const run of runs) {
        const tr = document.createElement('tr');
        tr.append(
            el('td', '', `${run.levelId}. ${run.levelName}`),
            el('td', 'table__num', formatScore(run.score)),
            el('td', 'table__num', formatAccuracy(run.accuracy)),
            el('td', 'table__num', String(run.bestCombo)),
            el('td', 'table__num', String(run.counterStrafes)),
            el('td', '', formatRelative(run.playedAt)),
        );
        body.append(tr);
    }
}
