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
 * The Play splash is shown by the page before the game chunk loads, so its click can arrive
 * before GameApp exists.  Fullscreen (and any pointer lock) may only be requested inside a
 * user gesture, so that early click requests fullscreen itself and records it in `early`.
 * GameApp later only shows the menu for an early click: it never requests fullscreen or
 * pointer lock again outside a gesture.
 * @param {{addEventListener:Function, textContent:string}} button
 * @param {{requestFullscreen?:Function}} stage
 * @param {{fullscreenElement?:unknown}} doc
 * @param {{clicked:boolean, fullscreen?:boolean}} early shared with GameApp
 */
export function bindEarlyStart(button, stage, doc, early) {
    button.addEventListener('click', () => {
        if (early.clicked) {
            return;
        }
        early.clicked = true;
        button.textContent = 'Loading…';
        early.fullscreen = requestFullscreenFromGesture(stage, doc);
    });
}

/**
 * Whether GameApp's start handler may request fullscreen: only when it is running inside
 * the click itself, never when replaying an early click that was already handled.
 * @param {{clicked:boolean}} early @param {boolean} insideGesture
 */
export function mayRequestFullscreen(early, insideGesture) {
    return insideGesture && !early.clicked;
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
