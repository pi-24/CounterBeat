/**
 * Tutorial.js (ui) - the on-screen coach for the three tutorial stages.
 * Shows the stage name and progress pips, the instruction, the stop-speed
 * thresholds that the speed arc uses, and a Skip button that is visible at
 * every step.  The logic lives in game/onboarding/tutorialStages.js.
 */
import { el } from './format.js';
import { STAGES } from '../game/onboarding/tutorialStages.js';
import { tutorialText } from '../input/prompts.js';
import { STOP_SPEED } from '../game/rules/rules.js';

export class TutorialPanel {
    /**
     * @param {HTMLElement} stage the stage element the panel lives in
     * @param {{onSkip:() => void, onRepeat?:() => void}} handlers
     */
    constructor(stage, handlers) {
        /** @type {'pad'|'kbm'} whose wording the stage text uses */
        this.device = 'kbm';
        this.root = el('aside', 'tutorial');
        this.root.hidden = true;
        this.root.setAttribute('aria-live', 'polite');
        this.title = el('div', 'tutorial__title');
        this.pips = el('div', 'tutorial__pips');
        this.text = el('p', 'tutorial__text');
        this.thresholds = el(
            'p', 'tutorial__thresholds mono',
            `Arc: green ≤ ${STOP_SPEED.perfect} u/s (Perfect) · ≤ ${STOP_SPEED.good} Good · ≤ ${STOP_SPEED.loose} Loose`,
        );
        const actions = el('div', 'tutorial__actions');
        this.repeat = el('button', 'btn btn--ghost btn--small', 'Restart stage');
        this.repeat.type = 'button';
        this.repeat.addEventListener('click', () => handlers.onRepeat?.());
        this.skip = el('button', 'btn btn--ghost btn--small', 'Skip tutorial');
        this.skip.type = 'button';
        this.skip.dataset.action = 'tutorial-skip';
        this.skip.addEventListener('click', () => handlers.onSkip());
        actions.append(this.repeat, this.skip);
        this.root.append(this.title, this.pips, this.text, this.thresholds, actions);
        stage.append(this.root);
    }

    /** @param {import('../game/onboarding/tutorialStages.js').TutorialProgress} [progress] */
    show(progress) {
        this.root.hidden = false;
        if (progress) {
            this.update(progress);
        }
    }
    hide() { this.root.hidden = true; }

    /**
     * @param {import('../game/onboarding/tutorialStages.js').TutorialProgress} progress
     * @param {boolean} [failed] show the stage's failure hint instead of the instruction
     */
    update(progress, failed = false) {
        const stage = progress.stage;
        this.title.textContent = stage
            ? `STEP ${progress.stageIndex + 1} OF ${STAGES.length}: ${stage.title}`
            : 'TUTORIAL COMPLETE';
        this.text.textContent = stage ? tutorialText(stage, this.device, failed) : 'You know the loop: stop, time, aim.';
        this.text.classList.toggle('is-fail', failed);
        const pips = [];
        for (let i = 0; i < progress.required; i += 1) {
            pips.push(el('span', `tutorial__pip${i < progress.count ? ' is-on' : ''}`));
        }
        this.pips.replaceChildren(...pips);
    }
}
