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
