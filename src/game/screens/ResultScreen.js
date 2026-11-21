/**
 * ResultScreen.js
 *
 * The end-of-run summary, as an overlay above the arena.  It is also the
 * point at which the run is handed back to the page, which is the only place
 * the game talks to storage - the screens themselves never import a
 * repository.
 */
import { resolveChart, dailyChartId, DIFFICULTIES, TRACKS } from '../rules/charts.js';
import { Showcase } from '../fps/Showcase.js';
import { el } from '../../ui/format.js';
import { themeProvider, feedbackBus } from '../providers/index.js';
import { awardsStars } from '../progress/stars.js';
import { newlyUnlocked } from '../progress/unlocks.js';
import { coinsText } from '../progress/coins.js';
import {
    buildResultsView, renderHistogram, meanSdText, personalBestText, judgementCells,
} from '../../ui/Results.js';
import { BOARD_TABS, BOARD_EMPTY, buildBoardView } from '../../ui/leaderboardModel.js';
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
        /** @type {{total:number, lines:object[], balance:number}|null} coins this run paid */
        this.coinAward = null;
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
        if (this.isReplay) {
            return;
        }
        let newStars = 0;
        if (this.level.kind === 'track' && awardsStars({ ...run, completed: this.record.completed })) {
            const prev = progress.starsFor(run.trackId, run.difficulty);
            const { before, total } = progress.record(run, { ...this.record, ...this.stopQuality });
            feedbackBus.emit('starsChanged', { total });
            const best = progress.starsFor(run.trackId, run.difficulty);
            newStars = best.filter((on, i) => on && !prev[i]).length;
            this.starResult = {
                best,
                isNew: best.map((on, i) => on && !prev[i]),
                unlocked: newlyUnlocked(TRACKS.map((t) => t.id), {}, before, total).map((id) => ResultScreen.unlockLabel(id)),
                total,
            };
        }
        // Coins: Campaign, Quick Play and Daily pay per level; the tutorial, Custom and Practice never get here with a reward.
        if (!this.level.tutorial && progress.awardCoins) {
            const award = progress.awardCoins({ ...run, kind: this.level.kind }, this.record, newStars);
            this.coinAward = award.total > 0 ? { ...award, balance: progress.coins } : null;
        }
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
        const cell = this.overlay.querySelector('#resultStarsCell');
        const unlocked = this.overlay.querySelector('#resultUnlocked');
        host.replaceChildren();
        cell.hidden = !this.starResult;
        unlocked.hidden = true;
        if (!this.starResult) {
            return;
        }
        // One glyph per star, each titled with what it is for; the newly earned ones are marked.
        this.starResult.best.forEach((on, i) => {
            const star = el('span', `result__star${on ? ' is-on' : ''}${this.starResult.isNew[i] ? ' is-new' : ''}`, on ? '★' : '☆');
            star.title = `${STAR_LABELS[i]}${this.starResult.isNew[i] ? ' (new)' : ''}`;
            host.append(star);
        });
        const total = el('span', 'result__star-total', `${this.starResult.total} TOTAL`);
        host.append(total);
        if (this.starResult.unlocked.length) {
            unlocked.textContent = `UNLOCKED: ${this.starResult.unlocked.join(', ')}`;
            unlocked.hidden = false;
        }
    }

    /** "+N coins" with the breakdown that makes it up, and the new balance. */
    renderCoins() {
        const host = this.overlay.querySelector('#resultCoins');
        if (!host) {
            return;
        }
        host.hidden = !this.coinAward;
        if (!this.coinAward) {
            return;
        }
        this.overlay.querySelector('#resultCoinsTotal').textContent = coinsText(this.coinAward.total);
        this.overlay.querySelector('#resultCoinsBalance').textContent = `BALANCE ${this.coinAward.balance.toLocaleString('en-GB')}`;
        const list = this.overlay.querySelector('#resultCoinsLines');
        list.replaceChildren();
        for (const line of this.coinAward.lines) {
            const row = el('li', '');
            row.append(el('span', '', line.label), el('b', '', `+${line.amount}`));
            list.append(row);
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
            off.textContent = meanSdText(this.timingErrorsMs) || view.offsetText;
            off.title = view.offsetText;
            off.classList.remove('is-early', 'is-late');
            if (view.offsetClass) off.classList.add(view.offsetClass);
        }
        const stops = o.querySelector('#resultStops');
        if (stops) {
            stops.textContent = view.stopStats.shots > 0 ? `${view.stopStats.good} / ${view.stopStats.shots} · ${view.stopStats.percent}%` : '–';
            stops.title = view.stopStats.text;
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
        // Read before the run is saved, so the personal-best delta is against the old best.
        this.previousBest = this.isReplay ? 0 : (this.app.services.getPersonalBest?.(this.level.chartId) ?? 0);
        const submit = this.routeRewards();
        this.render();
        this.overlay.hidden = false;
        this.boardTab = 'global';
        this.renderBoardTabs();
        if (submit) {
            this.outcome = (await submit) ?? {};
            if (this.app.current === this) {
                this.renderOutcome();
            }
        }
        if (this.app.current === this) {
            await this.loadBoard();
        }
    }

    /** The Global / Friends / Daily tab strip; the active tab is a button like the rest of the menu. */
    renderBoardTabs() {
        const host = this.overlay.querySelector('#boardTabs');
        host.replaceChildren();
        for (const tab of BOARD_TABS) {
            const button = el('button', `board__tab${tab.id === this.boardTab ? ' is-on' : ''}`, tab.label);
            button.type = 'button';
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(tab.id === this.boardTab));
            button.dataset.boardTab = tab.id;
            button.addEventListener('click', () => {
                this.boardTab = tab.id;
                this.renderBoardTabs();
                this.loadBoard();
            });
            host.append(button);
        }
    }

    /** @returns {Promise<object[]>} the rows for the active tab; Friends has no source yet. */
    async boardRows() {
        const { services } = this.app;
        if (this.boardTab === 'friends' || !services.leaderboard) {
            return [];
        }
        const chartId = this.boardTab === 'daily' ? dailyChartId() : this.level.chartId;
        try {
            return (await services.leaderboard(chartId)) ?? [];
        } catch (error) {
            console.warn('Could not load the leaderboard', error);
            return [];
        }
    }

    async loadBoard() {
        const tab = this.boardTab;
        const rows = await this.boardRows();
        if (this.app.current !== this || tab !== this.boardTab) {
            return;
        }
        this.renderBoard(buildBoardView(rows, { userId: this.app.services.getUserId?.() ?? null, top: 6, around: 2 }));
    }

    /** @param {ReturnType<typeof buildBoardView>} view */
    renderBoard(view) {
        const o = this.overlay;
        o.querySelector('#boardTitle').textContent = `${this.level.name.toUpperCase()} — ${view.total.toLocaleString('en-GB')} ${view.total === 1 ? 'ENTRY' : 'ENTRIES'}`;
        o.querySelector('#boardTop').textContent = view.topPercent;
        const place = o.querySelector('#boardPlace');
        place.hidden = !view.me;
        if (view.me) {
            o.querySelector('#boardPlaceNum').textContent = String(view.me.pos);
            o.querySelector('#boardPlaceOf').textContent = `OF ${view.total.toLocaleString('en-GB')}`;
        }
        const host = o.querySelector('#boardRows');
        host.replaceChildren();
        const empty = o.querySelector('#boardEmpty');
        empty.hidden = view.entries.length > 0;
        empty.textContent = BOARD_EMPTY[this.boardTab];
        if (!view.entries.length) {
            return;
        }
        const head = el('div', 'board__row board__row--head');
        head.append(el('span', '', '#'), el('span', '', 'PLAYER'), el('span', 'num', 'SCORE'), el('span', 'num', 'ACC'), el('span', 'num', 'CMB'), el('span', ''));
        host.append(head);
        for (const entry of view.entries) {
            if (entry.gap) {
                host.append(el('div', 'board__row board__row--gap', '···'));
                continue;
            }
            const row = el('div', `board__row${entry.top ? ' is-top' : ''}${entry.isMe ? ' is-me' : ''}`);
            const name = el('span', 'name', entry.name);
            if (entry.isMe) {
                name.append(el('small', '', 'YOU'));
            }
            row.append(el('span', 'pos', String(entry.pos)), name,
                el('span', 'num', entry.score.toLocaleString('en-GB')), el('span', 'num', entry.accuracy),
                el('span', 'num', String(entry.combo)));
            const replay = el('button', 'board__replay', '');
            replay.type = 'button';
            replay.setAttribute('aria-label', `Watch replay: ${entry.name}`);
            replay.disabled = !entry.hasReplay || !entry.runId;
            replay.addEventListener('click', () => this.watchReplay(entry.runId));
            row.append(replay);
            host.append(row);
        }
    }

    /** Loads another player's replay and plays it back. @param {string} runId */
    async watchReplay(runId) {
        const found = await this.app.services.replay?.(runId);
        if (found && this.app.current === this) {
            this.app.showReplay(found.chartId, found.log);
        }
    }

    /** Updates the parts of the screen that depend on the save result. */
    renderOutcome() {
        const o = this.overlay;
        const scoreLabel = o.querySelector('#resultScoreLabel');
        const pb = o.querySelector('#resultPb');
        const cap = o.querySelector('#resultRankCap');
        if (this.outcome.rejected) {
            scoreLabel.textContent = 'NOT VERIFIED · NOT RANKED';
            scoreLabel.className = 'result__score-label is-rejected';
            return;
        }
        if (typeof this.outcome.score === 'number' && this.outcome.score !== this.record.score) {
            o.querySelector('#resultScore').textContent = this.outcome.score.toLocaleString('en-GB');
        }
        const score = typeof this.outcome.score === 'number' ? this.outcome.score : this.record.score;
        const gain = this.outcome.personalBest ? personalBestText(this.previousBest ?? 0, score) : '';
        pb.textContent = gain;
        pb.hidden = !gain;
        cap.textContent = this.outcome.personalBest ? 'RANK — NEW BEST' : 'RANK';
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

        o.querySelector('#resultAcc').textContent = `${(r.accuracy * 100).toFixed(2)}%`;
        o.querySelector('#resultCombo').textContent = String(r.bestCombo);
        o.querySelector('#resultPb').hidden = true;
        o.querySelector('#resultRankCap').textContent = 'RANK';
        const hits = r.perfect + r.good + r.loose;
        o.querySelector('#resultCs').textContent = `×${r.counterStrafes}`;
        o.querySelector('#resultHeads').textContent = `${r.headshots ?? 0} / ${hits}`;

        // Each judgement cell carries its own shape, so colour is never the only cue.
        const cells = o.querySelector('#resultBreakdown');
        cells.replaceChildren();
        for (const cell of judgementCells(r)) {
            const label = el('small', '');
            label.append(el('i', `shape shape--${cell.key}`), cell.label);
            const item = el('div', '');
            item.append(label, el('b', '', String(cell.value)));
            cells.append(item);
        }

        this.renderStars();
        this.renderCoins();
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
