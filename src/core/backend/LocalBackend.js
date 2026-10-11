/**
 * LocalBackend.js
 *
 * Accounts and runs kept as JSON in this browser's local storage.  This is
 * the no-setup path: it is what a fresh clone runs on, and what the headless
 * tests run against.  Nothing is verified - there is no server to do it -
 * so runs are stored with the client's own score.
 */
import { AuthService } from '../AuthService.js';
import { UserRepository } from '../UserRepository.js';
import { ScoreRepository } from '../ScoreRepository.js';
import { store } from '../Storage.js';
import { validateRun } from '../../game/rules/validateRun.js';
import { getLevel } from '../../game/rules/levels.js';

const SETTINGS_KEY = 'settings';

export class LocalBackend {
    constructor() {
        this.kind = 'local';
        this.providers = [];
        this.users = new UserRepository();
        this.scores = new ScoreRepository();
        this.auth = new AuthService(this.users);
        /** @type {Set<(user:object|null)=>void>} */
        this.listeners = new Set();
    }

    async init() {
        // Local storage is synchronous; nothing to restore.
    }

    currentUser() {
        return this.auth.currentUser();
    }

    onAuthChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        const user = this.currentUser();
        for (const listener of this.listeners) {
            listener(user);
        }
    }

    async register(form) {
        const result = await this.auth.register(form);
        if (result.ok) {
            this.notify();
        }
        return result;
    }

    async login(email, password) {
        const result = await this.auth.login(email, password);
        if (result.ok) {
            this.notify();
        }
        return result;
    }

    async loginWithProvider() {
        return { ok: false, error: 'Sign-in providers need the hosted backend.' };
    }

    async logout() {
        this.auth.logout();
        this.notify();
    }

    /**
     * Runs the same validator the server would, so a local build behaves
     * like the real thing - a tampered or implausible log is refused here too.
     */
    async submitRun(record, log) {
        const user = this.currentUser();
        if (!user) {
            return { saved: false, accepted: false, score: record.score, personalBest: false };
        }
        const level = getLevel(record.levelId);
        const verdict = log ? validateRun(level, log, record.score) : { ok: true, record };
        if (!verdict.ok) {
            return { saved: false, accepted: false, rejected: true, reason: verdict.reason,
                score: record.score, personalBest: false };
        }
        const previous = this.scores.personalBest(user.id, record.levelId);
        const stored = this.scores.add({
            ...verdict.record,
            userId: user.id,
            displayName: user.displayName,
            mainGame: user.mainGame,
            verified: Boolean(log),
        });
        return {
            saved: true,
            accepted: true,
            score: stored.score,
            personalBest: !previous || stored.score > previous.score,
        };
    }

    async runsForUser(userId) {
        return this.scores.forUser(userId);
    }

    async personalBest(userId, levelId) {
        return this.scores.personalBest(userId, levelId);
    }

    async leaderboard(levelId = 'best') {
        return this.scores.leaderboard(this.users.all(), levelId);
    }

    async summary() {
        return this.scores.summary(this.users.all());
    }

    async clearRuns(userId) {
        this.scores.removeForUser(userId);
    }

    async loadSettings() {
        return store.read(SETTINGS_KEY, null);
    }

    async saveSettings(values) {
        store.write(SETTINGS_KEY, values);
    }
}
