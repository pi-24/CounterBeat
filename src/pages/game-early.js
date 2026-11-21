/**
 * game-early.js
 *
 * The first thing the game page runs, kept free of heavy imports: it shows the Play splash and
 * records an early click.  The page script (game-page.js) and the game chunk (GameApp.js) are
 * downloaded in parallel behind it by game-boot.js, so the splash and the menu are not queued
 * behind the account and progress code.
 */
import { bindEarlyStart } from '../game/onboarding/startFlow.js';
import { parseAtlasParams } from '../game/atlasParams.js';
import { isDesktop } from '../platform/platform.js';

/** Shared with GameApp: set when Play was clicked before the game chunk finished loading. */
export const early = { clicked: false };

/** Desktop splash hint: the app is already fullscreen, so name the one useful key instead. */
export const DESKTOP_START_HINT = 'Alt+Enter toggles windowed mode';

export function showEarlySplash() {
    const params = new URLSearchParams(window.location.search);
    const start = document.getElementById('startOverlay');
    if (parseAtlasParams(window.location.search) || params.get('replay') || !start) {
        return;
    }
    const button = start.querySelector('[data-action="start-play"]');
    start.hidden = false;
    if (isDesktop()) {
        // The desktop app already starts fullscreen: do not carry the browser-era instruction.
        start.querySelector('.start__hint').textContent = DESKTOP_START_HINT;
    }
    document.getElementById('loadingOverlay').hidden = true;
    bindEarlyStart(button, document.getElementById('stage'), document, early);
}
