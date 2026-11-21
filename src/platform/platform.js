/**
 * platform.js
 *
 * Runtime platform flag: 'web' (browser) or 'desktop' (the Electron shell).
 * The desktop shell exposes `window.counterbeatDesktop` through its preload
 * bridge; everything else is treated as web.  Pure functions take the window
 * so they can be tested headlessly.
 */

/** @param {any} [win] @returns {'web'|'desktop'} */
export function getPlatform(win = typeof window !== 'undefined' ? window : undefined) {
    return win?.counterbeatDesktop?.platform === 'desktop' ? 'desktop' : 'web';
}

export function isDesktop(win) {
    return getPlatform(win) === 'desktop';
}

/**
 * Marks the document so CSS hides the web shell (site header, guest banner, footer)
 * and, on the home page, sends the player straight into the game.
 * @returns {'web'|'desktop'}
 */
export function applyPlatform(win = window, doc = win.document) {
    const platform = getPlatform(win);
    doc.documentElement.dataset.platform = platform;
    if (platform === 'desktop') {
        doc.documentElement.classList.add('is-desktop');
    }
    return platform;
}

/** Tells the desktop shell whether to run windowed. No-op on web. */
export function setDesktopWindowed(windowed, win = window) {
    if (isDesktop(win) && typeof win.counterbeatDesktop.setWindowed === 'function') {
        win.counterbeatDesktop.setWindowed(Boolean(windowed));
    }
}

/**
 * The menu's account line. The desktop app has no site header or login page, so it never tells the player to
 * "log in" (AC28: no guest banner in the play flow); it states where scores are kept instead.
 * @param {{logged: boolean, name?: string, desktop: boolean}} state
 * @returns {{text: string, ok: boolean}}
 */
export function accountStatus({ logged, name = '', desktop }) {
    if (logged) return { text: `Signed in as ${name}. Scores are saved.`, ok: true };
    if (desktop) return { text: 'Progress is saved on this PC.', ok: true };
    return { text: 'Playing as a guest. Log in to save your scores.', ok: false };
}
