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
import { applyPlatform, setDesktopWindowed } from '../platform/platform.js';
import { initNavigation } from '../ui/Navigation.js';
import { REPLAYABLE_VERSIONS } from '../game/RunRecorder.js';
import { resolveChart } from '../game/rules/charts.js';
import { bootCloudSave } from '../progress/cloudSave.js';
import { settings } from '../game/Settings.js';
import { ProgressStore } from '../game/progress/store.js';
import { formatScore } from '../ui/format.js';
import { RunHistory } from '../ui/runHistory.js';
import { toast } from '../ui/Toast.js';
import { early } from './game-early.js';
import { parseAtlasParams, parseAtlasClean, atlasServices, memoryStorage, showAtlasScene, markAtlasReady } from '../game/atlasHook.js';



const platform = applyPlatform();
// Desktop: merge the Steam Cloud save file before anything reads settings/progress.
if (!parseAtlasParams(window.location.search)) bootCloudSave(store);
const backend = await initNavigation('game');
await settings.sync(backend);

if (platform === 'desktop') {
    for (const node of document.querySelectorAll('[data-desktop-only]')) {
        node.hidden = false;
    }
    for (const node of document.querySelectorAll('[data-desktop-quit]')) {
        node.addEventListener('click', () => window.counterbeatDesktop.quit?.());
    }
    setDesktopWindowed(settings.get('windowed'));
    let lastWindowed = settings.get('windowed');
    settings.onChange((values) => {
        if (values.windowed !== lastWindowed) {
            lastWindowed = values.windowed;
            setDesktopWindowed(values.windowed);
        }
    });
    // Alt+Enter is handled by the main process; mirror it into the saved setting.
    window.counterbeatDesktop.onWindowedChange?.((value) => settings.update({ windowed: value }));
}

const starProgress = new ProgressStore();
// The screenshot hook (?atlas_scene=) never touches saved progress.
const atlasParams = parseAtlasParams(window.location.search);
if (!atlasParams) {
    await starProgress.sync(backend);
}

const user = backend.currentUser();
/**
 * Best score and pass state per chart over every run the player has stored
 * (not just the recent ones), cached so the menu can read it synchronously.
 * @type {Map<string, object>}
 */
let progress = user ? await loadProgress() : new Map();

/** Durable local bests and passes for runs that are never ranked (guests; Easy, Normal, Campaign). */
const localBests = new LocalBestStore(store, user ? user.id : 'guest');

/** Last session and best ranks, for the main menu's preview panel (local only). */
const history = new RunHistory(store);

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

/**
 * Loads a stored replay for playback, or null when it is unavailable.
 * @param {string} runId
 * @returns {Promise<{chartId:string, log:object, run:object}|null>}
 */
async function loadReplay(runId) {
    try {
        const found = await backend.replay(runId);
        if (!found || !resolveChart(found.run.chartId) || !REPLAYABLE_VERSIONS.includes(found.log.version)) {
            return null;
        }
        return { chartId: found.run.chartId, log: found.log, run: found.run };
    } catch (error) {
        console.warn(error);
        return null;
    }
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
    history,

    getPlayerName() {
        return user ? user.displayName : 'Guest';
    },

    getUserId() {
        return user ? user.id : null;
    },

    /** Best verified run per player on a chart, for the results leaderboard. */
    async leaderboard(chartId) {
        return backend.leaderboard(chartId);
    },

    /** A stored replay for the leaderboard's watch buttons (null with a toast when unavailable). */
    async replay(runId) {
        const found = await loadReplay(runId);
        if (!found) {
            toast.error("That replay isn't available. Only each player's best run on a chart keeps its replay.");
        }
        return found;
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
        history.record(record, { mode: log?.mode });
        if (!user) {
            const { personalBest } = localBests.record(record);
            toast.info('Guest run finished. Log in before playing to save scores to the rankings.');
            return { saved: false, localOnly: true, reason: 'guest', personalBest, score: record.score };
        }

        // Easy, Normal, Campaign and Practice never reach the ranked server:
        // they keep a local personal best only (AC12).
        const gate = canSubmitRankedRun({ chartId: record.chartId, kind: record.kind, difficulty: record.difficulty, mode: log?.mode, speed: log?.speed });
        if (!gate.ok) {
            runToken?.catch?.(() => {});
            const { personalBest } = localBests.record(record);
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

    onJudgement() {},
};

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
            achievements: !atlasParams,
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
            services: atlasParams ? atlasServices(services, { clean: parseAtlasClean(window.location.search) }) : services,
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
