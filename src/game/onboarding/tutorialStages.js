/**
 * tutorialStages.js - progression for the three tutorial stages (Stop, Time,
 * Aim).  A stage advances only after REQUIRED successful actions; a wrong
 * action counts as a fail and is penalised, so stages can be failed and
 * repeated.  Skip is allowed at any point.  Pure logic.
 */
export const REQUIRED_SUCCESSES = 5; // GDD starting value (assumption)

export const STAGES = Object.freeze([
    Object.freeze({
        id: 'stop', title: 'STOP',
        hint: 'Strafe with A / D, then tap the opposite key to counter-strafe. Get the arc green (20 u/s or less)',
        failHint: 'Too fast. Tap the opposite key and let go; stop inside the green zone',
        onFail: 'step',
    }),
    Object.freeze({
        id: 'time', title: 'TIME',
        hint: 'Stop, then fire as the ring closes on the bot. Perfect or Good timing counts',
        failHint: 'Off the beat. Wait for the ring to close',
        onFail: 'step',
    }),
    Object.freeze({
        id: 'aim', title: 'AIM',
        hint: 'Stop, put the crosshair on the bot and fire on the beat. Hits count',
        failHint: 'Missed. Aim at the bot before the ring closes',
        onFail: 'step',
    }),
]);

export class TutorialProgress {
    /** @param {number} [required] successes per stage */
    constructor(required = REQUIRED_SUCCESSES) {
        this.required = required;
        this.stageIndex = 0;
        this.count = 0;
        this.failures = 0;
        this.skipped = false;
        this.lastResult = null;
    }

    get stage() { return this.stageIndex < STAGES.length ? STAGES[this.stageIndex] : null; }
    get complete() { return this.stageIndex >= STAGES.length && !this.skipped; }
    /** @returns {boolean} true once the tutorial is over by finishing or skipping */
    get finished() { return this.complete || this.skipped; }

    /**
     * @param {string} stageId the stage the action belongs to; actions for any
     *   other stage are ignored (a stray shot in the Stop stage is not a fail)
     * @param {boolean} success
     * @returns {'success'|'advance'|'complete'|'fail'|'ignored'}
     */
    record(stageId, success) {
        const stage = this.stage;
        if (this.finished || !stage || stage.id !== stageId) {
            return 'ignored';
        }
        if (!success) {
            this.failures += 1;
            this.count = stage.onFail === 'reset' ? 0 : Math.max(0, this.count - 1);
            this.lastResult = 'fail';
            return 'fail';
        }
        this.count += 1;
        if (this.count >= this.required) {
            this.stageIndex += 1;
            this.count = 0;
            this.lastResult = this.stageIndex >= STAGES.length ? 'complete' : 'advance';
            return this.lastResult;
        }
        this.lastResult = 'success';
        return 'success';
    }

    skip() { this.skipped = true; }

    /** Restarts the current stage (the "repeat" option). */
    repeatStage() { this.count = 0; this.lastResult = null; }

    /** @returns {string} e.g. "STOP  2/5" for the HUD */
    label() {
        const stage = this.stage;
        return stage ? `${stage.title}  ${this.count}/${this.required}` : 'DONE';
    }
}

/** @param {{grade:string}} judgement Time stage: Perfect or Good timing. */
export function timeSuccess(judgement) { return judgement.grade === 'perfect' || judgement.grade === 'good'; }
/** @param {{grade:string}} judgement Aim stage: any hit. */
export function aimSuccess(judgement) { return judgement.grade !== 'miss'; }
