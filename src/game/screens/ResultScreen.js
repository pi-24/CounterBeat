/**
 * ResultScreen.js
 *
 * The end-of-run summary, as an overlay above the arena.  It is also the
 * point at which the run is handed back to the page, which is the only place
 * the game talks to storage - the screens themselves never import a
 * repository.
 */
import { resolveChart, DIFFICULTIES } from '../rules/charts.js';
import { Showcase } from '../fps/Showcase.js';
import { el } from '../../ui/format.js';

export class ResultScreen {
    /**
     * @param {import('../GameApp.js').GameApp} app
     * @param {object} record
     * @param {string} chartId
     * @param {object} log the RunRecorder log, for verification
     * @param {{replay?: boolean}} [options] true when this was a replay, not a run
     */
    constructor(app, record, chartId, log, options = {}) {
        this.app = app;
        this.record = record;
        this.log = log;
        this.level = resolveChart(chartId);
        this.isReplay = Boolean(options.replay);
        this.follower = ResultScreen.nextChart(this.level);
        this.overlay = app.resultOverlay;
    }

    /**
     * The next rung on this track's ladder, if there is one.
     * @param {object} level
     * @returns {object|null}
     */
    static nextChart(level) {
        if (level.kind === 'tutorial') {
            return resolveChart('t:range:easy');
        }
        if (level.kind !== 'track') {
            return null;
        }
        const index = DIFFICULTIES.findIndex((d) => d.id === level.difficulty.id);
        const next = DIFFICULTIES[index + 1];
        return next ? resolveChart(`t:${level.trackId}:${next.id}`) : null;
    }

    async enter() {
        this.outcome = {};
        this.showcase = new Showcase(this.app.scene, this.app.camera, this.level);
        this.render();
        this.overlay.hidden = false;

        if (!this.level.tutorial && !this.isReplay) {
            // Saving can take a round trip to the server; the screen is up
            // already and updates when the verdict lands.
            this.outcome = (await this.app.services.onRunComplete(this.record, this.log)) ?? {};
            this.renderOutcome();
        }
    }

    /** Updates the parts of the screen that depend on the save result. */
    renderOutcome() {
        const o = this.overlay;
        const scoreLabel = o.querySelector('#resultScoreLabel');
        if (this.outcome.rejected) {
            scoreLabel.textContent = 'NOT VERIFIED \u2014 NOT RANKED';
            scoreLabel.className = 'result__score-label is-rejected';
            return;
        }
        if (typeof this.outcome.score === 'number' && this.outcome.score !== this.record.score) {
            o.querySelector('#resultScore').textContent = this.outcome.score.toLocaleString('en-GB');
        }
        scoreLabel.textContent = this.outcome.personalBest ? 'NEW PERSONAL BEST' : 'SCORE';
        scoreLabel.className = `result__score-label${this.outcome.personalBest ? ' is-best' : ''}`;
    }

    exit() {
        this.overlay.hidden = true;
        this.showcase.dispose();
    }

    /** @param {number} dt */
    update(dt) {
        this.showcase.update(dt);
    }

    render() {
        const r = this.record;
        const o = this.overlay;
        const passed = r.passed;

        const headline = o.querySelector('#resultHeadline');
        headline.textContent = this.isReplay ? 'REPLAY OVER' : this.level.tutorial ? 'TUTORIAL COMPLETE' : r.completed
            ? (passed ? 'CHART CLEARED' : 'FINISHED — NOT CLEAN ENOUGH')
            : 'RUN FAILED';
        headline.className = `result__headline ${passed ? 'result__headline--pass' : (r.completed ? 'result__headline--warn' : 'result__headline--fail')}`;

        const subtitle = o.querySelector('#resultSubtitle');
        if (this.isReplay) {
            subtitle.textContent = `${this.level.name} — as it was played`;
        } else if (this.level.tutorial) {
            subtitle.textContent = 'Not ranked. The Range on Easy is waiting.';
        } else if (this.level.kind === 'custom') {
            subtitle.textContent = `${this.level.name} — your own song, so this counts as a personal best only`;
        } else if (this.level.kind === 'daily') {
            subtitle.textContent = `${this.level.name} — one shot at the daily leaderboard per run, best counts`;
        } else if (r.completed) {
            subtitle.textContent = this.follower
                ? `${this.level.name} — ${Math.round(this.level.passAccuracy * 100)}% accuracy clears it and opens ${this.follower.difficulty.name}`
                : `${this.level.name} — the top of this track's ladder`;
        } else {
            subtitle.textContent = 'Your focus ran out. Missed bots drain it fastest.';
        }

        o.querySelector('#resultRank').textContent = r.rank;
        o.querySelector('#resultScore').textContent = r.score.toLocaleString('en-GB');
        const scoreLabel = o.querySelector('#resultScoreLabel');
        scoreLabel.textContent = this.level.tutorial || this.isReplay ? 'SCORE' : 'SAVING\u2026';
        scoreLabel.className = 'result__score-label';

        const rows = [
            ['Accuracy', `${(r.accuracy * 100).toFixed(1)}%`, 'perfect'],
            ['Perfect', String(r.perfect), 'perfect'],
            ['Good', String(r.good), 'good'],
            ['Loose', String(r.loose), 'ok'],
            ['Missed', String(r.missed), 'miss'],
            ['Best combo', String(r.bestCombo), ''],
            ['Counter-strafe bonuses', String(r.counterStrafes), 'cs'],
            ['Headshots', String(r.headshots ?? 0), 'cs'],
        ];
        const list = o.querySelector('#resultBreakdown');
        list.replaceChildren();
        for (const [label, value, tone] of rows) {
            const item = el('li', '');
            item.append(el('span', '', label), el('span', `mono result__value${tone ? ` result__value--${tone}` : ''}`, value));
            list.append(item);
        }

        const guest = o.querySelector('#resultGuest');
        guest.hidden = this.app.services.isLoggedIn() || this.level.tutorial || this.isReplay;

        const next = o.querySelector('[data-action="next"]');
        next.hidden = this.isReplay || !(this.follower && (passed || this.level.tutorial));
        if (this.follower) {
            next.textContent = `Next: ${this.follower.name}`;
        }
        o.querySelector('[data-action="retry"]').textContent = this.isReplay ? 'Watch again' : 'Retry';
    }

    retry() {
        if (this.isReplay) {
            this.app.showReplay(this.level.chartId, this.log);
            return;
        }
        this.app.showPlay(this.level.chartId);
    }

    next() {
        if (this.follower && (this.record.passed || this.level.tutorial)) {
            this.app.showPlay(this.follower.chartId);
        }
    }

    menu() {
        this.app.showMenu();
    }
}
