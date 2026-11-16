/**
 * game-page.js
 *
 * Boots the game and supplies the services object it talks to.  All of the
 * account and score work lives here, against the backend, so the game code
 * stays a self-contained simulation and the website keeps ownership of the
 * player's data.
 */
import { canSubmitRankedRun } from '../net/submit.js';
import { LocalBestStore } from '../net/localBest.js';
import { store } from '../core/Storage.js';
import { initNavigation } from '../ui/Navigation.js';
import { REPLAYABLE_VERSIONS } from '../game/RunRecorder.js';
import { TRACKS, DIFFICULTIES, resolveChart } from '../game/rules/charts.js';
import { GRADE_LABEL } from '../game/rules/config.js';
import { settings } from '../game/Settings.js';
import { ProgressStore } from '../game/progress/store.js';
import { formatScore, formatAccuracy, el } from '../ui/format.js';
import { toast } from '../ui/Toast.js';
import { early } from './game-early.js';
import { parseAtlasParams, atlasServices, memoryStorage, showAtlasScene, markAtlasReady } from '../game/atlasHook.js';



const backend = await initNavigation('game');
await settings.sync(backend);

const starProgress = new ProgressStore();
// The screenshot hook (?atlas_scene=) never touches saved progress.
const atlasParams = parseAtlasParams(window.location.search);
if (!atlasParams) {
    await starProgress.sync(backend);
}

const user = backend.currentUser();
const guestNotice = document.getElementById('guestNotice');
const sessionLog = document.getElementById('sessionLog');
const personalBests = document.getElementById('personalBests');

if (!user) {
    guestNotice.hidden = false;
}

/**
 * Best score and pass state per chart over every run the player has stored
 * (not just the recent ones), cached so the menu can read it synchronously.
 * @type {Map<string, object>}
 */
let progress = user ? await loadProgress() : new Map();

/** Durable local bests and passes for runs that are never ranked (guests; Easy, Normal, Campaign). */
const localBests = new LocalBestStore(store, user ? user.id : 'guest');

/** @returns {Promise<Map<string, object>>} */
async function loadProgress() {
    try {
        return await backend.progress(user.id);
    } catch (error) {
        console.warn('Could not load progress', error);
        return new Map();
    }
}

/** @param {string} chartId */
function bestOf(chartId) {
    return progress.get(chartId)?.bestScore ?? 0;
}

/** A replay requested in the URL (?replay=<run id>), loaded before boot. */
async function pendingReplay() {
    const runId = new URLSearchParams(window.location.search).get('replay');
    if (!runId) {
        return null;
    }
    try {
        const found = await backend.replay(runId);
        if (!found || !resolveChart(found.run.chartId) || !REPLAYABLE_VERSIONS.includes(found.log.version)) {
            toast.error("That replay isn't available. Only each player's best run on a chart keeps its replay.");
            return null;
        }
        toast.info(`Replay: ${found.run.displayName ?? 'a player'} on ${found.run.levelName}, scoring ${formatScore(found.run.score)}.`);
        return { chartId: found.run.chartId, log: found.log };
    } catch (error) {
        console.warn(error);
        return null;
    }
}

/** @type {import('../game/GameApp.js').GameServices} */
const services = {
    progress: starProgress,

    getPlayerName() {
        return user ? user.displayName : 'Guest';
    },

    isLoggedIn() {
        return user !== null;
    },

    hasPassed(chartId) {
        if (!user) {
            return localBests.hasPassed(chartId);
        }
        return Boolean(progress.get(chartId)?.passed) || localBests.hasPassed(chartId);
    },

    getPersonalBest(chartId) {
        return user ? Math.max(bestOf(chartId), localBests.bestOf(chartId)) : localBests.bestOf(chartId);
    },

    startRun(chartId) {
        // Guests' runs are not saved, so they need no token.
        return user ? backend.startRun(chartId) : null;
    },

    async onRunComplete(record, log, runToken) {
        if (!user) {
            const { personalBest } = localBests.record(record);
            renderPersonalBests();
            toast.info('Guest run finished. Log in before playing to save scores to the rankings.');
            return { saved: false, localOnly: true, personalBest, score: record.score };
        }

        // Easy, Normal, Campaign and Practice never reach the ranked server:
        // they keep a local personal best only (AC12).
        const gate = canSubmitRankedRun({ chartId: record.chartId, kind: record.kind, difficulty: record.difficulty, mode: log?.mode, speed: log?.speed });
        if (!gate.ok) {
            runToken?.catch?.(() => {});
            const { personalBest } = localBests.record(record);
            renderPersonalBests();
            return { saved: true, localOnly: true, reason: gate.reason, personalBest, score: record.score };
        }

        const token = runToken ? await runToken : null;
        const result = await backend.submitRun(record, log, token);
        if (result.reason === 'signed-out') {
            toast.error('Your session has expired, so the run was not saved. Log in again to keep saving scores.');
            return { saved: false, score: record.score, personalBest: false };
        }
        if (result.rejected) {
            toast.error(`Run not verified (${result.reason ?? 'replay failed'}). It will not be ranked.`);
            return { saved: false, rejected: true, reason: result.reason, score: record.score, personalBest: false };
        }
        if (!result.saved) {
            toast.error('Could not reach the server; the run was not saved.');
            return { saved: false, score: record.score, personalBest: false };
        }

        progress = await loadProgress();
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
            el('span', 'mono', best ? `${formatScore(best)} · ${bestDifficulty.name}` : '-'),
        );
        list.append(item);
    }
    personalBests.append(list);

    let best = null;
    for (const entry of progress.values()) {
        if ((entry.kind === 'track' || entry.kind === 'daily') && (best === null || entry.maxAccuracy > best.maxAccuracy)) {
            best = entry;
        }
    }
    if (best && best.maxAccuracy > 0) {
        const name = resolveChart(best.chartId)?.name ?? best.chartId;
        personalBests.append(el('p', 'card__foot',
            `Best accuracy so far: ${formatAccuracy(best.maxAccuracy)} on ${name}.`));
    }
}

renderPersonalBests();

/** Embedded launch (Play on the web pages): chrome hidden, a way back to the site. */
function setupEmbedded() {
    if (new URLSearchParams(window.location.search).get('embed') !== '1' || window.parent === window) {
        return;
    }
    document.body.classList.add('is-embedded');
    const exit = document.getElementById('embedExit');
    if (exit) {
        exit.hidden = false;
        exit.addEventListener('click', () => {
            window.parent.postMessage({ type: 'counterbeat-exit' }, window.location.origin);
        });
    }
}

setupEmbedded();

/** Starts the game, or explains why it could not start. */
async function boot() {
    const stage = document.getElementById('stage');
    const canvas = document.getElementById('gameCanvas');

    try {
        const replay = await pendingReplay();
        const { GameApp } = await import('../game/GameApp.js');
        const app = new GameApp({
            early,
            replay,
            skipStart: Boolean(atlasParams),
            storage: atlasParams ? memoryStorage() : undefined,
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
            services: atlasParams ? atlasServices(services) : services,
        });
        await app.boot();
        if (atlasParams) {
            await showAtlasScene(app, atlasParams);
        } else {
            // Plain load too: the splash is on screen, but the flag waits until the lazily loaded
            // chunks and streamed audio are in, so a screenshot harness never stops the server
            // mid-fetch.
            markAtlasReady(app);
        }
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
