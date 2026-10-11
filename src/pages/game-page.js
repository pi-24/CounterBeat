/**
 * game-page.js
 *
 * Boots the game and supplies the services object it talks to.  All of the
 * account and score work lives here, against the backend, so the game code
 * stays a self-contained simulation and the website keeps ownership of the
 * player's data.
 */
import { initNavigation } from '../ui/Navigation.js';
import { GameApp } from '../game/GameApp.js';
import { TRACKS, DIFFICULTIES, resolveChart } from '../game/rules/charts.js';
import { GRADE_LABEL } from '../game/rules/config.js';
import { settings } from '../game/Settings.js';
import { formatScore, formatAccuracy, el } from '../ui/format.js';
import { toast } from '../ui/Toast.js';

const backend = await initNavigation('game');
await settings.sync(backend);

const user = backend.currentUser();
const guestNotice = document.getElementById('guestNotice');
const sessionLog = document.getElementById('sessionLog');
const personalBests = document.getElementById('personalBests');

if (!user) {
    guestNotice.hidden = false;
}

/** The player's runs, cached so the menu can read them synchronously. */
let runs = user ? await backend.runsForUser(user.id) : [];

/** Guest progress and scores only last as long as the page is open. */
const guestState = { passed: new Set(), bestByChart: new Map() };

/** @param {string} chartId */
function bestOf(chartId) {
    return runs
        .filter((run) => run.chartId === chartId && (run.verified !== false || run.kind === 'custom'))
        .reduce((top, run) => Math.max(top, run.score), 0);
}

/** A replay requested in the URL (?replay=<run id>), loaded before boot. */
async function pendingReplay() {
    const runId = new URLSearchParams(window.location.search).get('replay');
    if (!runId) {
        return null;
    }
    try {
        const found = await backend.replay(runId);
        if (!found || !resolveChart(found.run.chartId)) {
            toast.error('That replay is not available any more.');
            return null;
        }
        toast.info(`Replay: ${found.run.displayName ?? 'a player'} on ${found.run.levelName} — ${formatScore(found.run.score)}.`);
        return { chartId: found.run.chartId, log: found.log };
    } catch (error) {
        console.warn(error);
        return null;
    }
}

/** @type {import('../game/GameApp.js').GameServices} */
const services = {
    getPlayerName() {
        return user ? user.displayName : 'Guest';
    },

    isLoggedIn() {
        return user !== null;
    },

    hasPassed(chartId) {
        if (!user) {
            return guestState.passed.has(chartId);
        }
        return runs.some((run) => run.chartId === chartId && run.passed && run.verified !== false);
    },

    getPersonalBest(chartId) {
        return user ? bestOf(chartId) : (guestState.bestByChart.get(chartId) ?? 0);
    },

    async onRunComplete(record, log) {
        if (!user) {
            const previous = guestState.bestByChart.get(record.chartId) ?? 0;
            if (record.score > previous) {
                guestState.bestByChart.set(record.chartId, record.score);
            }
            if (record.passed) {
                guestState.passed.add(record.chartId);
            }
            renderPersonalBests();
            toast.info('Guest run finished. Log in before playing to save scores to the rankings.');
            return { saved: false, personalBest: record.score > previous, score: record.score };
        }

        const result = await backend.submitRun(record, log);
        if (result.rejected) {
            toast.error(`Run not verified (${result.reason ?? 'replay failed'}) — it will not be ranked.`);
            return { saved: false, rejected: true, reason: result.reason, score: record.score, personalBest: false };
        }
        if (!result.saved) {
            toast.error('Could not reach the server; the run was not saved.');
            return { saved: false, score: record.score, personalBest: false };
        }

        runs = await backend.runsForUser(user.id);
        renderPersonalBests();
        if (record.kind === 'custom') {
            toast.success(result.personalBest
                ? `New personal best on ${record.levelName}: ${formatScore(result.score)} (your own song, not ranked).`
                : `Saved: ${formatScore(result.score)} on ${record.levelName} (your own song, not ranked).`);
        } else {
            toast.success(result.personalBest
                ? `New personal best on ${record.levelName}: ${formatScore(result.score)}.`
                : `Run verified: ${formatScore(result.score)} on ${record.levelName}.`);
        }
        return { saved: true, personalBest: result.personalBest, score: result.score };
    },

    onJudgement(judgement) {
        appendToSessionLog(judgement);
    },
};

/** @param {object} judgement */
function appendToSessionLog(judgement) {
    if (sessionLog.dataset.ready !== 'true') {
        sessionLog.replaceChildren();
        sessionLog.dataset.ready = 'true';
    }
    const row = el('div', 'session-log__row');
    const flags = [judgement.counterStrafed ? '+CS' : '', judgement.headshot ? 'HS' : '']
        .filter(Boolean).join(' ');
    const label = flags ? `${GRADE_LABEL[judgement.grade]} ${flags}` : GRADE_LABEL[judgement.grade];
    const detail = judgement.grade === 'miss'
        ? judgement.reason
        : `${judgement.timingError >= 0 ? '+' : ''}${Math.round(judgement.timingError * 1000)} ms  ${Math.round(judgement.speed)} u/s`;
    row.append(el('span', `session-log__grade--${judgement.grade}`, label), el('span', '', detail));
    sessionLog.prepend(row);
    while (sessionLog.childElementCount > 40) {
        sessionLog.lastElementChild.remove();
    }
}

function renderPersonalBests() {
    personalBests.replaceChildren();
    const list = el('ul', 'rail__list');
    for (const track of TRACKS) {
        let best = 0;
        let bestDifficulty = null;
        for (const difficulty of DIFFICULTIES) {
            const score = services.getPersonalBest(`t:${track.id}:${difficulty.id}`);
            if (score > best) {
                best = score;
                bestDifficulty = difficulty;
            }
        }
        const item = document.createElement('li');
        item.append(
            el('span', '', track.name),
            el('span', 'mono', best ? `${formatScore(best)} · ${bestDifficulty.name}` : '—'),
        );
        list.append(item);
    }
    personalBests.append(list);

    const best = runs.filter((run) => run.kind === 'track' || run.kind === 'daily')
        .reduce((top, run) => (top === null || run.accuracy > top.accuracy ? run : top), null);
    if (best && best.accuracy > 0) {
        personalBests.append(el('p', 'card__foot',
            `Best accuracy so far: ${formatAccuracy(best.accuracy)} on ${best.levelName}.`));
    }
}

renderPersonalBests();

/** Starts the game, or explains why it could not start. */
async function boot() {
    const stage = document.getElementById('stage');
    const canvas = document.getElementById('gameCanvas');
    const loadingText = document.getElementById('loadingText');

    try {
        const replay = await pendingReplay();
        const app = new GameApp({
            replay,
            canvas,
            stage,
            hudRoot: document.getElementById('hud'),
            overlays: {
                loading: document.getElementById('loadingOverlay'),
                menu: document.getElementById('menuOverlay'),
                pause: document.getElementById('pauseOverlay'),
                result: document.getElementById('resultOverlay'),
                calibration: document.getElementById('calibrationOverlay'),
            },
            settingsForm: document.getElementById('settingsForm'),
            services,
            onProgress(done, total) {
                loadingText.textContent = `Loading audio ${done}/${total}…`;
            },
        });
        await app.boot();
    } catch (error) {
        console.error(error);
        showError(error instanceof Error ? error.message : String(error));
    }
}

/** @param {string} message */
function showError(message) {
    const loading = document.getElementById('loadingOverlay');
    const overlay = document.getElementById('errorOverlay');
    const text = document.getElementById('errorMessage');
    if (loading) {
        loading.hidden = true;
    }
    if (overlay && text) {
        text.textContent = message;
        overlay.hidden = false;
    }
}

boot();
