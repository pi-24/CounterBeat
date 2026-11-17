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
import { GRADE_ICONS } from '../feel/judgementPalette.js';
import { themeProvider, feedbackBus } from '../providers/index.js';
import { awardsStars } from '../progress/stars.js';
import { newlyUnlocked } from '../progress/unlocks.js';
import { buildResultsView, renderHistogram } from '../../ui/Results.js';
import { isPractice, routeRunResult, loopSummaryText } from '../modes/practice.js';

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
        this.timingErrorsMs = options.timingErrorsMs ?? [];
        this.practiceSection = options.section ?? null;
        this.loopPasses = options.loopPasses ?? [];
    }

    /** Records the run's stars in the local progress store (never sent to the server). */
    recordStars() {
        const progress = this.app.services.progress;
        if (!this.isReplay && !this.level.tutorial) {
            const r = this.record;
            feedbackBus.emit('runComplete', {
                mode: this.runMode, difficulty: r.difficulty, rank: r.rank, completed: r.completed,
                passed: r.passed === true, fullCombo: r.completed === true && r.missed === 0,
            });
        }
        const run = {
            mode: this.runMode, trackId: this.level.trackId, difficulty: this.record.difficulty, speed: this.runSpeed,
        };
        if (this.level.kind !== 'track' || this.isReplay
            || !awardsStars({ ...run, completed: this.record.completed })) {
            return;
        }
        const prev = progress.starsFor(run.trackId, run.difficulty);
        const { before, total } = progress.record(run, { ...this.record, ...this.stopQuality });
        feedbackBus.emit('starsChanged', { total });
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

    /** Timing-error histogram, mean offset and stop-quality stats. */
    renderTiming() {
        const view = buildResultsView({
            record: this.record, timingErrorsMs: this.timingErrorsMs, stopQuality: this.stopQuality,
            mode: this.runMode, hasNext: Boolean(this.follower), isReplay: this.isReplay,
        });
        const o = this.overlay;
        const host = o.querySelector('#resultTiming');
        if (!host) {
            return;
        }
        host.hidden = this.isReplay;
        const hist = o.querySelector('#resultHist');
        if (hist) renderHistogram(hist, view.histogram);
        const off = o.querySelector('#resultOffset');
        if (off) {
            off.textContent = view.offsetText;
            off.classList.remove('is-early', 'is-late');
            if (view.offsetClass) off.classList.add(view.offsetClass);
        }
        const stops = o.querySelector('#resultStops');
        if (stops) stops.textContent = view.stopStats.text;
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

    /**
     * Hands the run to the reward paths (stars, then submission) and returns the pending submit, if any.
     * Practice never reaches either; replays pass through routeRunResult but recordStars gates on
     * the mode and onSubmit refuses replays and the tutorial. Kept apart from enter() so it can be tested without a scene.
     * @returns {Promise<object|null>|null}
     */
    routeRewards() {
        const mode = this.isReplay ? 'replay' : this.runMode;
        let submit = null;
        routeRunResult(mode, {
            onStars: () => {
                this.recordStars(); // before the first render, so stars and unlock text paint right away
            },
            onSubmit: () => {
                if (this.level.tutorial || this.isReplay) {
                    return false;
                }
                // Saving can take a round trip to the server; the screen is up
                // already and updates when the verdict lands.
                submit = this.app.services.onRunComplete(this.record, this.log, this.runToken);
                return true;
            },
        });
        return submit;
    }

    async enter() {
        this.outcome = {};
        this.showcase = new Showcase(this.app.scene, this.app.camera, this.level);
        const submit = this.routeRewards();
        this.render();
        this.overlay.hidden = false;
        if (submit) {
            this.outcome = (await submit) ?? {};
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
        if (this.outcome.localOnly && this.record.kind !== 'custom') {
            scoreLabel.textContent = localOnlyLabel(this.outcome);
            scoreLabel.className = `result__score-label${this.outcome.personalBest ? ' is-best' : ''}`;
            return;
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
        if (isPractice(this.runMode) && !this.isReplay) {
            const passes = loopSummaryText(this.loopPasses);
            subtitle.textContent = `${this.level.name}: practice run, no stars or scores are saved${passes ? ` · ${passes}` : ''}`;
        } else if (this.isReplay) {
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
            // Each grade row carries its distinct icon, so colour is never the only cue.
            const icon = label === 'Accuracy' ? undefined : GRADE_ICONS[tone];
            item.append(el('span', '', icon ? `${icon} ${label}` : label), el('span', `mono result__value${tone ? ` result__value--${tone}` : ''}`, value));
            list.append(item);
        }

        this.renderStars();
        this.renderTiming();

        const guest = o.querySelector('#resultGuest');
        guest.hidden = this.app.services.isLoggedIn() || this.level.tutorial || this.isReplay || isPractice(this.runMode);

        const next = o.querySelector('[data-action="next"]');
        next.hidden = this.isReplay || !(this.follower && (passed || this.level.tutorial || isPractice(this.runMode)));
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
        this.app.showPlay(this.level.chartId, this.runMode, this.practiceSection ? { section: this.practiceSection } : {});
    }

    next() {
        if (this.follower && (this.record.passed || this.level.tutorial || isPractice(this.runMode))) {
            this.app.showPlay(this.follower.chartId, this.runMode);
        }
    }

    menu() {
        this.app.showMenu();
    }
}

/**
 * The score label for a run kept locally: guests are told why (not logged in), gated
 * difficulties/modes are told which ones rank.
 * @param {{personalBest?:boolean, reason?:string}} outcome
 */
export function localOnlyLabel(outcome) {
    if (outcome.reason === 'guest') {
        return outcome.personalBest ? 'NEW LOCAL BEST · LOG IN TO RANK' : 'GUEST RUN · LOG IN TO RANK';
    }
    return outcome.personalBest ? 'NEW LOCAL BEST · NOT RANKED' : 'LOCAL BEST ONLY · HARD AND EXPERT ARE RANKED';
}
