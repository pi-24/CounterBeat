/**
 * firstRun.js - the first-run flag.  Calibration then the tutorial start
 * automatically while it is unset; completing OR skipping sets it, so they
 * never auto-start again.  Both are replayable from the menu at any time.
 */
export const FIRST_RUN_KEY = 'onboarding';

/** @param {{read:Function}} storage */
export function isOnboardingDone(storage) {
    const record = storage.read(FIRST_RUN_KEY, null);
    return Boolean(record && record.done === true);
}

/** @param {{read:Function}} storage */
export function shouldAutoStart(storage) {
    return !isOnboardingDone(storage);
}

/**
 * @param {{write:Function}} storage
 * @param {'completed'|'skipped'} how
 */
export function markOnboardingDone(storage, how = 'completed') {
    storage.write(FIRST_RUN_KEY, { done: true, how, version: 1 });
}

/** The ordered first-run steps. */
export const FIRST_RUN_STEPS = Object.freeze(['calibration', 'tutorial']);

/** Calibration taps for the automatic first-run pass (the full test has 16). */
export const SHORT_CALIBRATION_TAPS = 8;
export const FULL_CALIBRATION_TAPS = 16;

/** Fewest taps (as a share of the measured beats) that make a calibration trustworthy. */
export const MIN_TAP_SHARE = 0.4;

/**
 * What a finished calibration pass should do.  The automatic first-run pass
 * must ALWAYS continue to the tutorial, even with zero taps (the default
 * offset is kept), so it can never dead-end.
 * @param {number} tapCount taps that landed near a click
 * @param {number} measured beats that counted
 * @param {boolean} auto first-run pass
 * @returns {'apply'|'retry'|'keep'}
 */
export function calibrationOutcome(tapCount, measured, auto) {
    if (tapCount >= Math.ceil(measured * MIN_TAP_SHARE)) {
        return 'apply';
    }
    return auto ? 'keep' : 'retry';
}
