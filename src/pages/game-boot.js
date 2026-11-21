/**
 * game-boot.js - the game page's entry.  Shows the Play splash at once, then starts the game chunk downloading.
 * game.html loads game-page.js as a second, parallel module script (its imports are
 * preloaded by the browser), so neither waits for the other.
 */
import { showEarlySplash } from './game-early.js';

showEarlySplash();
import('../game/GameApp.js').catch(() => { /* boot() in game-page.js reports it */ });
