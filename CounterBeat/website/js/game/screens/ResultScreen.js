/**
 * ResultScreen.js
 *
 * The end-of-run summary, as an overlay above the arena.  It is also the
 * point at which the run is handed back to the page, which is the only place
 * the game talks to storage - the screens themselves never import a
 * repository.
 */
import { getLevel, nextLevel } from '../levels.js';
import { Showcase } from '../fps/Showcase.js';
import { el } from '../../ui/format.js';

export class ResultScreen {
    /**
     * @param {import('../GameApp.js').GameApp} app
     * @param {object} record
     * @param {number} levelId
     */
    constructor(app, record, levelId) {
        this.app = app;
        this.record = record;
        this.level = getLevel(levelId);
        this.follower = nextLevel(levelId);
        this.overlay = app.resultOverlay;
    }

    async enter() {
        this.outcome = this.app.services.onRunComplete(this.record) ?? {};
        this.showcase = new Showcase(this.app.scene, this.app.camera, this.level);
        this.render();
        this.overlay.hidden = false;
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
        headline.textContent = r.completed
            ? (passed ? 'LEVEL CLEARED' : 'FINISHED — NOT CLEAN ENOUGH')
            : 'RUN FAILED';
        headline.className = `result__headline ${passed ? 'result__headline--pass' : (r.completed ? 'result__headline--warn' : 'result__headline--fail')}`;

        o.querySelector('#resultSubtitle').textContent = r.completed
            ? `${this.level.name} — ${Math.round(this.level.passAccuracy * 100)}% accuracy needed to unlock the next level`
            : 'Your focus ran out. Missed bots drain it fastest.';

        o.querySelector('#resultRank').textContent = r.rank;
        o.querySelector('#resultScore').textContent = r.score.toLocaleString('en-GB');
        const scoreLabel = o.querySelector('#resultScoreLabel');
        scoreLabel.textContent = this.outcome.personalBest ? 'NEW PERSONAL BEST' : 'SCORE';
        scoreLabel.className = `result__score-label${this.outcome.personalBest ? ' is-best' : ''}`;

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
        guest.hidden = this.app.services.isLoggedIn();

        const next = o.querySelector('[data-action="next"]');
        next.hidden = !(this.follower && passed);
        if (this.follower) {
            next.textContent = `Next: ${this.follower.name}`;
        }
    }

    retry() {
        this.app.showPlay(this.level.id);
    }

    next() {
        if (this.follower && this.record.passed) {
            this.app.showPlay(this.follower.id);
        }
    }

    menu() {
        this.app.showMenu();
    }
}
