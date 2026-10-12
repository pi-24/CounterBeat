/**
 * profile-page.js
 *
 * The player's own page: account details, best run per track, a timing
 * profile built from every verified run, and recent history with replays.
 */
import { initNavigation } from '../ui/Navigation.js';
import { TRACKS, DIFFICULTIES } from '../game/rules/charts.js';
import { TIMING_BUCKETS, TIMING_RANGE } from '../game/rules/Scorer.js';
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
    // Totals, bests and clears come from every run the player has stored;
    // the timing chart and history use the most recent ones.
    const [runs, progress] = await Promise.all([
        backend.runsForUser(user.id),
        backend.progress(user.id).catch((error) => {
            console.warn('Could not load progress', error);
            return new Map();
        }),
    ]);
    const ranked = [...progress.values()].filter((entry) => entry.kind === 'track' || entry.kind === 'daily');
    renderStats(ranked);
    renderBests(progress, ranked);
    renderTiming(runs);
    renderHistory(runs);
}

/** @param {object} run @returns {boolean} counted towards rankings */
function isRanked(run) {
    return (run.kind === 'track' || run.kind === 'daily' || run.kind === undefined)
        && run.levelId > 0 && run.verified !== false;
}

/** @param {object[]} ranked progress entries for official and daily charts */
function renderStats(ranked) {
    const runCount = ranked.reduce((sum, entry) => sum + entry.runs, 0);
    const best = ranked.reduce((top, entry) => Math.max(top, entry.bestScore), 0);
    const bestAccuracy = ranked.reduce((top, entry) => Math.max(top, entry.maxAccuracy), 0);
    const totalCounterStrafes = ranked.reduce((sum, entry) => sum + entry.counterStrafes, 0);

    document.getElementById('profileStats').replaceChildren(
        statTile('Runs played', String(runCount)),
        statTile('Best score', runCount ? formatScore(best) : '-'),
        statTile('Best accuracy', runCount ? formatAccuracy(bestAccuracy) : '-'),
        statTile('Counter-strafe bonuses', String(totalCounterStrafes)),
    );
}

function renderDetails() {
    const fields = [
        ['Display name', user.displayName],
        ['Email', user.email || '-'],
        ['Main game', user.mainGame || '-'],
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

/**
 * @param {Map<string, object>} progress every chart the player has a run on
 * @param {object[]} ranked the official and daily entries of it
 */
function renderBests(progress, ranked) {
    const host = document.getElementById('profileBests');
    host.replaceChildren();
    const list = el('ul', 'rail__list');
    for (const track of TRACKS) {
        const best = ranked
            .filter((entry) => entry.trackId === track.id)
            .reduce((top, entry) => (top === null || entry.bestScore > top.bestScore ? entry : top), null);
        const cleared = DIFFICULTIES.filter((d) => progress.get(`t:${track.id}:${d.id}`)?.passed);
        const item = document.createElement('li');
        item.append(
            el('span', '', `${track.name}${cleared.length ? `  ·  cleared ${cleared.map((d) => d.name).join(', ')}` : ''}`),
            el('span', 'mono', best
                ? `${formatScore(best.bestScore)}  ·  ${formatAccuracy(best.bestAccuracy)}`
                : 'Not played'),
        );
        list.append(item);
    }
    // Your own songs: the best run per song, across its difficulties.
    const bySong = new Map();
    for (const entry of progress.values()) {
        if (entry.kind !== 'custom') {
            continue;
        }
        const key = entry.trackName ?? entry.trackId ?? entry.chartId;
        if (!bySong.has(key) || entry.bestScore > bySong.get(key).bestScore) {
            bySong.set(key, entry);
        }
    }
    for (const [name, entry] of bySong) {
        const item = document.createElement('li');
        item.append(
            el('span', '', `${name}  ·  your song`),
            el('span', 'mono', `${formatScore(entry.bestScore)}  ·  ${formatAccuracy(entry.bestAccuracy)}`),
        );
        list.append(item);
    }
    host.append(list);
}

/**
 * The timing histogram: every verified run's buckets summed, drawn as bars
 * from -100 ms (early) to +100 ms (late), with the bias and spread beside it.
 * @param {object[]} runs
 */
function renderTiming(runs) {
    const svg = document.getElementById('timingChart');
    const summary = document.getElementById('timingSummary');
    const tiles = document.getElementById('timingStats');
    svg.replaceChildren();
    tiles.replaceChildren();

    // Verified runs only: custom-song stats come from the client unchecked.
    const withStats = runs.filter((run) => isRanked(run)
        && run.stats && Array.isArray(run.stats.buckets) && run.stats.hits > 0);
    if (withStats.length === 0) {
        summary.textContent = 'Play a few charts and your hit timing shows up here.';
        return;
    }
    const buckets = new Array(TIMING_BUCKETS).fill(0);
    let hits = 0;
    let weightedMean = 0;
    for (const run of withStats) {
        run.stats.buckets.forEach((count, index) => { buckets[index] += count; });
        hits += run.stats.hits;
        weightedMean += run.stats.mean * run.stats.hits;
    }
    const mean = weightedMean / hits;
    const peak = Math.max(...buckets);
    const width = 600;
    const height = 170;
    const left = 10;
    const bottom = 140;
    const barWidth = (width - left * 2) / TIMING_BUCKETS;
    const ns = 'http://www.w3.org/2000/svg';

    buckets.forEach((count, index) => {
        const bar = document.createElementNS(ns, 'rect');
        const h = peak ? (count / peak) * 110 : 0;
        const centre = Math.abs(index - (TIMING_BUCKETS - 1) / 2) <= 1;
        bar.setAttribute('x', String(left + index * barWidth + 2));
        bar.setAttribute('y', String(bottom - h));
        bar.setAttribute('width', String(barWidth - 4));
        bar.setAttribute('height', String(h));
        bar.setAttribute('rx', '2');
        bar.setAttribute('class', `timing__bar${centre ? ' timing__bar--centre' : ''}`);
        svg.append(bar);
    });
    const axis = document.createElementNS(ns, 'line');
    axis.setAttribute('x1', String(left));
    axis.setAttribute('x2', String(width - left));
    axis.setAttribute('y1', String(bottom + 0.5));
    axis.setAttribute('y2', String(bottom + 0.5));
    axis.setAttribute('class', 'timing__axis');
    svg.append(axis);
    for (const [fraction, label] of [[0, `−${TIMING_RANGE * 1000} ms early`], [0.5, 'on the beat'], [1, `+${TIMING_RANGE * 1000} ms late`]]) {
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', String(left + fraction * (width - left * 2)));
        text.setAttribute('y', String(height - 8));
        text.setAttribute('text-anchor', fraction === 0 ? 'start' : (fraction === 1 ? 'end' : 'middle'));
        text.setAttribute('class', 'timing__label');
        text.textContent = label;
        svg.append(text);
    }

    const bias = Math.round(mean * 1000);
    const ranked = runs.filter(isRanked);
    const hitsRanked = ranked.reduce((sum, run) => sum + (run.perfect + run.good + run.loose), 0);
    const counterStrafes = ranked.reduce((sum, run) => sum + run.counterStrafes, 0);
    const headshots = ranked.reduce((sum, run) => sum + (run.headshots ?? 0), 0);
    const perfects = ranked.reduce((sum, run) => sum + run.perfect, 0);

    summary.textContent = `${hits.toLocaleString('en-GB')} hits across ${withStats.length} runs. `
        + (Math.abs(bias) < 5
            ? 'You sit right on the beat.'
            : `You tend to fire ${Math.abs(bias)} ms ${bias < 0 ? 'early' : 'late'}. `
              + (bias < 0 ? 'Wait a hair longer on the ring.' : 'Try shooting as the ring closes, not after. Calibrating in Settings → Timing may also help.'));
    tiles.append(
        statTile('Average offset', `${bias >= 0 ? '+' : ''}${bias} ms`),
        statTile('Perfect rate', hitsRanked ? `${Math.round((perfects / hitsRanked) * 100)}%` : '-'),
        statTile('Counter-strafe rate', hitsRanked ? `${Math.round((counterStrafes / hitsRanked) * 100)}%` : '-'),
        statTile('Headshot rate', hitsRanked ? `${Math.round((headshots / hitsRanked) * 100)}%` : '-'),
    );
}

/** @param {object[]} runs */
function renderHistory(runs) {
    const body = document.getElementById('profileHistory');
    body.replaceChildren();
    const recent = runs.slice(0, 20);

    if (recent.length === 0) {
        const tr = document.createElement('tr');
        const td = el('td', 'table__empty', 'No runs yet.');
        td.colSpan = 8;
        tr.append(td);
        body.append(tr);
        return;
    }

    for (const run of recent) {
        const tr = document.createElement('tr');
        const status = run.kind === 'custom' ? 'own song' : (run.verified ? 'verified' : 'unverified');
        const replay = el('td', '');
        if (run.hasReplay) {
            const link = el('a', 'table__link', 'Watch');
            link.href = `game.html?replay=${encodeURIComponent(run.id)}`;
            replay.append(link);
        } else {
            replay.textContent = '-';
        }
        tr.append(
            el('td', '', run.levelName),
            el('td', 'table__num', formatScore(run.score)),
            el('td', 'table__num', formatAccuracy(run.accuracy)),
            el('td', 'table__num', String(run.bestCombo)),
            el('td', 'table__num', String(run.counterStrafes)),
            el('td', '', status),
            el('td', '', formatRelative(run.playedAt)),
            replay,
        );
        body.append(tr);
    }
}
