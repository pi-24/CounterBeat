/**
 * MenuScreen.js
 *
 * Level select and settings, drawn as an HTML overlay above a slowly
 * drifting view of the arena.  A level is locked until the one before it
 * has been finished, which is what makes the difficulty curve mean
 * something rather than just being three charts in a list.
 */
import { LEVELS } from '../levels.js';
import { Showcase } from '../fps/Showcase.js';
import { el } from '../../ui/format.js';

export class MenuScreen {
    /** @param {import('../GameApp.js').GameApp} app */
    constructor(app) {
        this.app = app;
        this.overlay = app.menuOverlay;
        this.cards = [];
        this.unsubscribe = [];
    }

    async enter() {
        const unlocked = this.app.services.getUnlockedLevel();
        const showcaseLevel = LEVELS.find((level) => level.id === Math.min(unlocked, 3)) ?? LEVELS[1];
        this.showcase = new Showcase(this.app.scene, this.app.camera, showcaseLevel);

        this.renderHeader();
        this.renderCards(unlocked);
        this.overlay.hidden = false;

        this.unsubscribe.push(this.app.input.onPress((code) => {
            const match = /^Digit([0-3])$/.exec(code);
            if (match) {
                this.tryStart(Number(match[1]));
            }
        }));

        // Menu music needs an unlocked context, which the first click gives.
        if (this.app.audio.ready && this.app.audio.context.state === 'running') {
            this.app.audio.resetMusicVolume();
            this.app.audio.playMusic('music-menu', true);
        } else {
            const start = async () => {
                await this.app.audio.unlock();
                if (!this.app.audio.musicKey && this.app.current === this) {
                    this.app.audio.resetMusicVolume();
                    this.app.audio.playMusic('music-menu', true);
                }
            };
            window.addEventListener('pointerdown', start, { once: true });
            this.unsubscribe.push(() => window.removeEventListener('pointerdown', start));
        }
    }

    exit() {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe = [];
        this.overlay.hidden = true;
        this.showcase.dispose();
        this.app.audio.stopMusic();
    }

    /** @param {number} dt */
    update(dt) {
        this.showcase.update(dt);
    }

    renderHeader() {
        const name = this.app.services.getPlayerName();
        const logged = this.app.services.isLoggedIn();
        const status = this.overlay.querySelector('#menuStatus');
        status.textContent = logged
            ? `Signed in as ${name} — scores are saved`
            : 'Playing as a guest — log in to save your scores';
        status.className = `menu__status ${logged ? 'menu__status--ok' : 'menu__status--warn'}`;
    }

    /** @param {number} unlocked the highest unlocked level id */
    renderCards(unlocked) {
        const host = this.overlay.querySelector('#levelCards');
        host.replaceChildren();
        this.cards = [];

        for (const level of LEVELS) {
            const isUnlocked = level.tutorial || level.id <= unlocked;
            const best = level.tutorial ? 0 : this.app.services.getPersonalBest(level.id);

            const card = el('button', `level-pick${isUnlocked ? '' : ' is-locked'}`);
            card.type = 'button';
            card.disabled = !isUnlocked;

            const thumb = document.createElement('img');
            thumb.className = 'level-pick__thumb';
            thumb.src = `images/levels/level-${level.tutorial ? 1 : level.id}.png`;
            thumb.alt = `${level.name} arena`;

            const body = el('span', 'level-pick__body');
            body.append(
                el('span', 'level-pick__key', level.tutorial ? 'T' : String(level.id)),
                el('span', 'level-pick__name', level.name),
                el('span', 'level-pick__sub', level.subtitle),
                el('span', 'level-pick__meta',
                    `${level.bpm} BPM  •  ${level.lanes} windows  •  ±${Math.round(level.timing.perfect * 1000)} ms`),
                el('span', `level-pick__foot${isUnlocked ? '' : ' level-pick__foot--locked'}`,
                    level.tutorial
                        ? 'Cannot be failed \u2014 not ranked'
                        : (isUnlocked
                            ? (best ? `Your best: ${best.toLocaleString('en-GB')}` : 'Not played yet')
                            : `Finish level ${level.id - 1} to unlock`)),
            );
            card.append(thumb, body);
            card.addEventListener('click', () => this.tryStart(level.id));
            host.append(card);
            this.cards.push({ level, unlocked: isUnlocked });
        }
    }

    /** @param {number} levelId */
    tryStart(levelId) {
        const card = this.cards.find((entry) => entry.level.id === levelId);
        if (!card || !card.unlocked) {
            this.app.audio.play('sfx-miss', { volume: 0.4 });
            return;
        }
        this.app.audio.play('sfx-ui', { volume: 0.5 });
        this.app.showPlay(levelId);
    }
}
