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

/** Shared with GameApp: set when Play was clicked before the game chunk finished loading. */
export const early = { clicked: false };

export function showEarlySplash() {
    const params = new URLSearchParams(window.location.search);
    const start = document.getElementById('startOverlay');
    if (parseAtlasParams(window.location.search) || params.get('replay') || !start) {
        return;
    }
    const button = start.querySelector('[data-action="start-play"]');
    start.hidden = false;
    document.getElementById('loadingOverlay').hidden = true;
    bindEarlyStart(button, document.getElementById('stage'), document, early);
}
