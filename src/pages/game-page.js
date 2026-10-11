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
import { LEVELS } from '../game/rules/levels.js';
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
const guestState = { unlockedLevel: 1, bestByLevel: new Map() };

/** @param {number} levelId */
function bestOf(levelId) {
    return runs
        .filter((run) => run.levelId === levelId && run.verified !== false)
        .reduce((top, run) => Math.max(top, run.score), 0);
}

/** @type {import('../game/GameApp.js').GameServices} */
const services = {
    getPlayerName() {
        return user ? user.displayName : 'Guest';
    },

    isLoggedIn() {
        return user !== null;
    },

    getUnlockedLevel() {
        if (!user) {
            return guestState.unlockedLevel;
        }
        let unlocked = 1;
        for (const level of LEVELS) {
            if (level.tutorial) {
                continue;
            }
            const cleared = runs.some((run) => run.levelId === level.id && run.completed && run.passed);
            if (cleared) {
                unlocked = Math.max(unlocked, level.id + 1);
            }
        }
        return Math.min(unlocked, LEVELS[LEVELS.length - 1].id);
    },

    getPersonalBest(levelId) {
        return user ? bestOf(levelId) : (guestState.bestByLevel.get(levelId) ?? 0);
    },

    async onRunComplete(record, log) {
        if (!user) {
            const previous = guestState.bestByLevel.get(record.levelId) ?? 0;
            if (record.score > previous) {
                guestState.bestByLevel.set(record.levelId, record.score);
            }
            if (record.passed) {
                guestState.unlockedLevel = Math.max(guestState.unlockedLevel, record.levelId + 1);
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
        toast.success(result.personalBest
            ? `New personal best on ${record.levelName}: ${formatScore(result.score)}.`
            : `Run verified: ${formatScore(result.score)} on ${record.levelName}.`);
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
    for (const level of LEVELS) {
        if (level.tutorial) {
            continue;
        }
        const score = services.getPersonalBest(level.id);
        const item = document.createElement('li');
        item.append(
            el('span', '', `${level.id}. ${level.name}`),
            el('span', 'mono', score ? formatScore(score) : '—'),
        );
        list.append(item);
    }
    personalBests.append(list);

    const best = runs.filter((run) => run.levelId > 0)
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
        const app = new GameApp({
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
