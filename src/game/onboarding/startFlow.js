/**
 * startFlow.js - the pure decisions behind the Play splash and the in-game
 * pointer-lock prompt (no DOM lookups, so they are unit-tested).
 */

/**
 * Requests fullscreen on `stage`.  Must be called synchronously from the
 * user-gesture (click) handler, or browsers refuse.
 * @param {{requestFullscreen?:Function}} stage
 * @param {{fullscreenElement?:unknown}} doc
 * @returns {boolean} true when a request was made
 */
export function requestFullscreenFromGesture(stage, doc) {
    if (doc.fullscreenElement || typeof stage.requestFullscreen !== 'function') {
        return false;
    }
    const result = stage.requestFullscreen();
    if (result && typeof result.catch === 'function') {
        result.catch(() => { /* refused: the game still plays windowed */ });
    }
    return true;
}

/**
 * Whether the in-game "click to capture the mouse" prompt shows.  It shows
 * while a live run (or the atlas tutorial still) has no pointer lock.
 * @param {{paused?:boolean, finished?:boolean, replay?:unknown, atlas?:unknown,
 *          conductor?:unknown, level?:{tutorial?:boolean}}|null} play
 * @param {boolean} locked
 */
export function lockPromptNeeded(play, locked) {
    if (!play || play.paused || play.finished || play.replay || locked) {
        return false;
    }
    if (play.atlas) {
        return Boolean(play.level?.tutorial);
    }
    return Boolean(play.conductor);
}

/**
 * The run mode a screen plays in.  The tutorial always runs in its own
 * 'tutorial' mode so it can never award stars, record progress or be submitted.
 * @param {{tutorial?:boolean}|null} level @param {string|null|undefined} mode
 * @param {string} fallback mode to use when none is given
 */
export function resolveRunMode(level, mode, fallback) {
    return level?.tutorial ? 'tutorial' : (mode ?? fallback);
}

/**
 * Chart ran out mid-tutorial: restart the chart on the stage the player is on.
 * @param {{finished:boolean, repeatStage:Function}|null} progress
 * @returns {boolean} true when the tutorial should replay the chart
 */
export function tutorialNeedsRestart(progress) {
    if (!progress || progress.finished) {
        return false;
    }
    progress.repeatStage();
    return true;
}
