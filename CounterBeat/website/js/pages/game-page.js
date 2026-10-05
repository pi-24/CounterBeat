/**
 * game-page.js
 *
 * Boots the game and supplies the services object it talks to.  All of
 * the storage work lives here rather than inside the scenes, so the game code
 * stays a self-contained simulation and the website keeps ownership of the
 * user's data.
 */
import { initNavigation } from '../ui/Navigation.js';
import { auth } from '../core/AuthService.js';
import { scoreRepository } from '../core/ScoreRepository.js';
import { GameApp } from '../game/GameApp.js';
import { LEVELS } from '../game/levels.js';
import { GRADE_LABEL } from '../game/config.js';
import { formatScore, formatAccuracy, el } from '../ui/format.js';
import { toast } from '../ui/Toast.js';

initNavigation('game');

const user = auth.currentUser();
const guestNotice = document.getElementById('guestNotice');
const sessionLog = document.getElementById('sessionLog');
const personalBests = document.getElementById('personalBests');

if (!user) {
    guestNotice.hidden = false;
}

/** Guest progress and scores only last as long as the page is open. */
const guestState = { unlockedLevel: 1, bestByLevel: new Map() };

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
            const cleared = scoreRepository.forUser(user.id).some((run) => (
                run.levelId === level.id && run.completed && run.accuracy >= level.passAccuracy
            ));
            if (cleared) {
                unlocked = Math.max(unlocked, level.id + 1);
            }
        }
        return Math.min(unlocked, LEVELS.length);
    },

    getPersonalBest(levelId) {
        if (!user) {
            return guestState.bestByLevel.get(levelId) ?? 0;
        }
        const best = scoreRepository.personalBest(user.id, levelId);
        return best ? best.score : 0;
    },

    onRunComplete(record) {
        const previousBest = services.getPersonalBest(record.levelId);
        const isPersonalBest = record.score > previousBest;

        if (!user) {
            if (isPersonalBest) {
                guestState.bestByLevel.set(record.levelId, record.score);
            }
            if (record.passed) {
                guestState.unlockedLevel = Math.max(guestState.unlockedLevel, record.levelId + 1);
            }
            renderPersonalBests();
            toast.info('Guest run finished. Log in before playing to save scores to the rankings.');
            return { saved: false, personalBest: isPersonalBest };
        }

        scoreRepository.add({
            ...record,
            userId: user.id,
            displayName: user.displayName,
            country: user.country,
        });

        renderPersonalBests();
        toast.success(isPersonalBest
            ? `New personal best on ${record.levelName}: ${formatScore(record.score)}.`
            : `Run saved: ${formatScore(record.score)} on ${record.levelName}.`);

        return { saved: true, personalBest: isPersonalBest };
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

    const gradeNode = el('span', `session-log__grade--${judgement.grade}`, label);
    const detail = judgement.grade === 'miss'
        ? judgement.reason
        : `${judgement.timingError >= 0 ? '+' : ''}${Math.round(judgement.timingError * 1000)} ms  ${Math.round(judgement.speed)} u/s`;

    row.append(gradeNode, el('span', '', detail));
    sessionLog.prepend(row);

    while (sessionLog.childElementCount > 40) {
        sessionLog.lastElementChild.remove();
    }
}

function renderPersonalBests() {
    personalBests.replaceChildren();
    const list = el('ul', 'rail__list');

    for (const level of LEVELS) {
        const score = services.getPersonalBest(level.id);
        const item = document.createElement('li');
        item.append(
            el('span', '', `${level.id}. ${level.name}`),
            el('span', 'mono', score ? formatScore(score) : '—'),
        );
        list.append(item);
    }
    personalBests.append(list);

    if (user) {
        const best = scoreRepository.personalBest(user.id);
        if (best && best.accuracy > 0) {
            personalBests.append(el('p', 'card__foot',
                `Best accuracy so far: ${formatAccuracy(best.accuracy)} on ${best.levelName}.`));
        }
    }
}

renderPersonalBests();

/** Starts the game, or explains why it could not start. */
async function boot() {
    if (typeof BABYLON === 'undefined') {
        showError('The 3D engine did not load. Check that vendor/babylon.js is present.');
        return;
    }
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
