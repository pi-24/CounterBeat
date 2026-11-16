import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSubmitRanked } from '../../src/core/customGate.js';
import { CUSTOM_LABEL } from '../../src/ui/CustomSongs.js';
import { ScoreRepository } from '../../src/core/ScoreRepository.js';

test('custom charts are rejected from ranked', () => {
    assert.equal(canSubmitRanked({ kind: 'custom' }).ok, false);
    assert.equal(canSubmitRanked({ chartId: 'custom:abc:hard' }).ok, false);
    assert.equal(canSubmitRanked({ custom: true }).ok, false);
    assert.equal(ScoreRepository.isRanked({ kind: 'custom', levelId: 6 }), false);
});

test('built-in charts pass the gate and label says Beta', () => {
    assert.equal(canSubmitRanked({ kind: 'track', chartId: 't:range:hard' }).ok, true);
    assert.match(CUSTOM_LABEL, /beta/i);
});

test('menu renders Beta label and unranked note from CustomSongs', async () => {
    const { readFileSync } = await import('node:fs');
    const { CUSTOM_NOTE } = await import('../../src/ui/CustomSongs.js');
    const src = readFileSync(new URL('../../src/game/screens/MenuScreen.js', import.meta.url), 'utf8');
    assert.match(src, /el\('span', 'beta-tag', CUSTOM_LABEL\)/);
    assert.match(src, /CUSTOM_NOTE/);
    assert.match(CUSTOM_NOTE, /unranked/i);
});

test('core does not import from ui', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/core/ScoreRepository.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\.\.\/ui\//);
});
