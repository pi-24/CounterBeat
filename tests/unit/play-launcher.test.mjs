import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldLaunchEmbedded, embedUrl } from '../../src/pages/playLauncher.js';

test('a plain primary click launches the embedded fullscreen game', () => {
    assert.equal(shouldLaunchEmbedded({ button: 0 }, true), true);
});

test('modified clicks, other buttons and no fullscreen support follow the link', () => {
    assert.equal(shouldLaunchEmbedded({ button: 0, ctrlKey: true }, true), false);
    assert.equal(shouldLaunchEmbedded({ button: 1 }, true), false);
    assert.equal(shouldLaunchEmbedded({ button: 0 }, false), false);
});

test('the embed URL keeps the page and adds the embed flag', () => {
    assert.equal(embedUrl('game.html'), 'game.html?embed=1');
});

import { shouldCloseOnFullscreenChange } from '../../src/pages/playLauncher.js';
test('leaving fullscreen never closes the embedded frame (a live run is not discarded by Esc)', () => {
    assert.equal(shouldCloseOnFullscreenChange(true, false), false);
    assert.equal(shouldCloseOnFullscreenChange(false, false), false);
    assert.equal(shouldCloseOnFullscreenChange(false, true), false);
    assert.equal(shouldCloseOnFullscreenChange(true, true), false);
});
