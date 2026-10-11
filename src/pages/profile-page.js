/**
 * profile-page.js
 *
 * The player's own page: account details, best run per level and recent
 * history, plus the option to clear that history.
 */
import { initNavigation } from '../ui/Navigation.js';
import { LEVELS } from '../game/rules/levels.js';
import {
    formatScore, formatAccuracy, formatDate, formatRelative, statTile, el,
} from '../ui/format.js';
import { toast } from '../ui/Toast.js';

const backend = await initNavigation('profile');

const user = backend.currentUser();
const guestNotice = document.getElementById('guestNotice');
const loading = document.getElementById('profileLoading');
const content = document.getElementById('profileContent');

if (!user) {
    loading.hidden = true;
    guestNotice.hidden = false;
    document.getElementById('profileSubtitle').textContent = 'Log in to see the details stored against your account.';
} else {
    document.getElementById('profileHeading').textContent = user.displayName;
    document.getElementById('profileSubtitle').textContent = user.createdAt
        ? `Member since ${formatDate(user.createdAt)}.`
        : '';
    renderDetails();
    await refresh();
    loading.hidden = true;
    content.hidden = false;

    document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
        await backend.clearRuns(user.id);
        await refresh();
        toast.info('Run history cleared. Your account details are untouched.');
    });
}

async function refresh() {
    const runs = await backend.runsForUser(user.id);
    renderStats(runs);
    renderBests(runs);
    renderHistory(runs);
}

/** @param {object[]} runs */
function renderStats(runs) {
    const ranked = runs.filter((run) => run.levelId > 0);
    const best = ranked.reduce((top, run) => (top === null || run.score > top.score ? run : top), null);
    const totalCounterStrafes = ranked.reduce((sum, run) => sum + run.counterStrafes, 0);
    const bestAccuracy = ranked.reduce((top, run) => Math.max(top, run.accuracy), 0);

    document.getElementById('profileStats').replaceChildren(
        statTile('Runs played', String(ranked.length)),
        statTile('Best score', best ? formatScore(best.score) : '—'),
        statTile('Best accuracy', ranked.length ? formatAccuracy(bestAccuracy) : '—'),
        statTile('Counter-strafe bonuses', String(totalCounterStrafes)),
    );
}

function renderDetails() {
    const fields = [
        ['Display name', user.displayName],
        ['Email', user.email || '—'],
        ['Main game', user.mainGame || '—'],
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

/** @param {object[]} runs */
function renderBests(runs) {
    const host = document.getElementById('profileBests');
    host.replaceChildren();
    const list = el('ul', 'rail__list');
    for (const level of LEVELS.filter((entry) => !entry.tutorial)) {
        const best = runs
            .filter((run) => run.levelId === level.id)
            .reduce((top, run) => (top === null || run.score > top.score ? run : top), null);
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

/** @param {object[]} runs */
function renderHistory(runs) {
    const body = document.getElementById('profileHistory');
    body.replaceChildren();
    const recent = runs.slice(0, 20);

    if (recent.length === 0) {
        const tr = document.createElement('tr');
        const td = el('td', 'table__empty', 'No runs yet.');
        td.colSpan = 7;
        tr.append(td);
        body.append(tr);
        return;
    }

    for (const run of recent) {
        const tr = document.createElement('tr');
        tr.append(
            el('td', '', `${run.levelId}. ${run.levelName}`),
            el('td', 'table__num', formatScore(run.score)),
            el('td', 'table__num', formatAccuracy(run.accuracy)),
            el('td', 'table__num', String(run.bestCombo)),
            el('td', 'table__num', String(run.counterStrafes)),
            el('td', '', run.verified ? '✓' : '—'),
            el('td', '', formatRelative(run.playedAt)),
        );
        body.append(tr);
    }
}
