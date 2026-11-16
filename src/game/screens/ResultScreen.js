/**
 * ResultScreen.js
 *
 * The end-of-run summary, as an overlay above the arena.  It is also the
 * point at which the run is handed back to the page, which is the only place
 * the game talks to storage - the screens themselves never import a
 * repository.
 */
import { resolveChart, DIFFICULTIES, TRACKS } from '../rules/charts.js';
import { Showcase } from '../fps/Showcase.js';
import { el } from '../../ui/format.js';
import { themeProvider } from '../providers/index.js';
import { awardsStars } from '../progress/stars.js';
import { newlyUnlocked } from '../progress/unlocks.js';

const STAR_LABELS = ['Pass', 'Rank A or better', 'Clean stops'];

export class ResultScreen {
    /**
     * @param {import('../GameApp.js').GameApp} app
     * @param {object} record
     * @param {string} chartId
     * @param {object} log the RunRecorder log, for verification
     * @param {{replay?: boolean, runToken?: Promise<string|null>|null}} [options]
     *   `replay` when this was a replay, not a run; `runToken` the server's
     *   token for a ranked run (see PlayScreen.enter)
     */
    constructor(app, record, chartId, log, options = {}) {
        this.app = app;
        this.record = record;
        this.log = log;
        this.level = resolveChart(chartId);
        this.isReplay = Boolean(options.replay);
        this.runToken = options.runToken ?? null;
        this.follower = ResultScreen.nextChart(this.level);
        this.overlay = app.resultOverlay;
        this.runMode = options.runMode ?? 'quickPlay';
        this.runSpeed = options.speed ?? 1;
        this.stopQuality = options.stopQuality ?? { stopShots: 0, stopGood: 0 };
        /** @type {{best:boolean[], isNew:boolean[], unlocked:string[], total:number}|null} */
        this.starResult = null;
    }

    /** Records the run's stars in the local progress store (never sent to the server). */
    recordStars() {
        const progress = this.app.services.progress;
        const run = {
            mode: this.runMode, trackId: this.level.trackId, difficulty: this.record.difficulty, speed: this.runSpeed,
        };
        if (this.level.kind !== 'track' || this.isReplay
            || !awardsStars({ ...run, completed: this.record.completed })) {
            return;
        }
        const prev = progress.starsFor(run.trackId, run.difficulty);
        const { before, total } = progress.record(run, { ...this.record, ...this.stopQuality });
        const best = progress.starsFor(run.trackId, run.difficulty);
        const groups = {
            theme: [...themeProvider.themes.values()],
            target: [...themeProvider.targets.values()],
            crosshair: [...themeProvider.crosshairs.values()],
        };
        this.starResult = {
            best,
            isNew: best.map((on, i) => on && !prev[i]),
            unlocked: newlyUnlocked(TRACKS.map((t) => t.id), groups, before, total).map((id) => ResultScreen.unlockLabel(id)),
            total,
        };
    }

    /** @param {string} id e.g. 'track:neon' or 'crosshair:xh-ring' */
    static unlockLabel(id) {
        const [kind, key] = id.split(':');
        if (kind === 'track') {
            return `Track: ${TRACKS.find((t) => t.id === key)?.name ?? key}`;
        }
        const map = { theme: themeProvider.themes, target: themeProvider.targets, crosshair: themeProvider.crosshairs }[kind];
        return `${kind[0].toUpperCase()}${kind.slice(1)}: ${map?.get(key)?.name ?? key}`;
    }

    /** The three campaign stars for this chart plus anything the new total opened. */
    renderStars() {
        const host = this.overlay.querySelector('#resultStars');
        host.replaceChildren();
        host.hidden = !this.starResult;
        if (!this.starResult) {
            return;
        }
        const row = el('div', 'result__star-row');
        this.starResult.best.forEach((on, i) => {
            const star = el('span', `result__star${on ? ' is-on' : ''}${this.starResult.isNew[i] ? ' is-new' : ''}`,
                `${on ? '★' : '☆'} ${STAR_LABELS[i]}`);
            row.append(star);
        });
        host.append(row, el('p', 'result__star-total mono', `★ ${this.starResult.total} total`));
        if (this.starResult.unlocked.length) {
            host.append(el('p', 'result__unlocked', `Unlocked: ${this.starResult.unlocked.join(', ')}`));
        }
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
        this.recordStars();
        this.showcase = new Showcase(this.app.scene, this.app.camera, this.level);
        this.render();
        this.overlay.hidden = false;

        if (!this.level.tutorial && !this.isReplay) {
            // Saving can take a round trip to the server; the screen is up
            // already and updates when the verdict lands.
            this.outcome = (await this.app.services.onRunComplete(this.record, this.log, this.runToken)) ?? {};
            if (this.app.current === this) {
                this.renderOutcome();
            }
        }
    }

    /** Updates the parts of the screen that depend on the save result. */
    renderOutcome() {
        const o = this.overlay;
        const scoreLabel = o.querySelector('#resultScoreLabel');
        if (this.outcome.rejected) {
            scoreLabel.textContent = 'NOT VERIFIED \u00b7 NOT RANKED';
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
            ? (passed ? 'CHART CLEARED' : 'FINISHED · NOT CLEAN ENOUGH')
            : 'RUN FAILED';
        headline.className = `result__headline ${passed ? 'result__headline--pass' : (r.completed ? 'result__headline--warn' : 'result__headline--fail')}`;

        const subtitle = o.querySelector('#resultSubtitle');
        if (this.isReplay) {
            subtitle.textContent = `${this.level.name}, as it was played`;
        } else if (this.level.tutorial) {
            subtitle.textContent = 'Not ranked. The Range on Easy is waiting.';
        } else if (this.level.kind === 'custom') {
            subtitle.textContent = `${this.level.name}: your own song, so this counts as a personal best only`;
        } else if (this.level.kind === 'daily') {
            subtitle.textContent = `${this.level.name}: one shot at the daily leaderboard per run, best counts`;
        } else if (r.completed) {
            subtitle.textContent = this.follower
                ? `${this.level.name}: ${Math.round(this.level.passAccuracy * 100)}% accuracy clears it`
                : `${this.level.name}: the top of this track's ladder`;
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

        this.renderStars();

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
        this.app.showPlay(this.level.chartId, this.log?.mode);
    }

    next() {
        if (this.follower && (this.record.passed || this.level.tutorial)) {
            this.app.showPlay(this.follower.chartId, this.log?.mode);
        }
    }

    menu() {
        this.app.showMenu();
    }
}
