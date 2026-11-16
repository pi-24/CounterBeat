import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveChart, TRACKS } from '../../src/game/rules/charts.js';
import { progressLabel } from '../../src/game/fps/hudText.js';

const manifest = JSON.parse(readFileSync(new URL('../../data/tracks.json', import.meta.url), 'utf8'));

test('the tutorial HUD shows the chart BPM, which is the Range track BPM everywhere', () => {
    const level = resolveChart('tutorial');
    const range = manifest.tracks.find((t) => t.id === 'range');
    assert.equal(level.bpm, 90);
    assert.equal(level.bpm, range.bpm);
    assert.equal(level.bpm, TRACKS.find((t) => t.id === 'range').bpm);
    assert.equal(progressLabel(2, 10, level.bpm), 'Bot 2/10  •  90 BPM');
});

test('every official chart reports its manifest BPM', () => {
    for (const t of manifest.tracks) {
        assert.equal(resolveChart(`t:${t.id}:normal`).bpm, t.bpm, t.id);
    }
});

test('the generated audio is built at the manifest BPM and length (audio vs chart)', () => {
    const py = readFileSync(new URL('../../tools/asset-tools/gen_audio.py', import.meta.url), 'utf8');
    const builders = { range: 'build_level_one', drift: 'build_drift', neon: 'build_level_two', breakneck: 'build_breakneck', vault: 'build_level_three', overclock: 'build_overclock' };
    for (const t of manifest.tracks) {
        const m = py.match(new RegExp(String.raw`def ${builders[t.id]}\(bpm=([\d.]+), bars=(\d+)\)`));
        assert.ok(m, t.id);
        assert.equal(Number(m[1]), t.bpm, `${t.id} audio BPM`);
        assert.equal(Number(m[2]), t.bars, `${t.id} audio bars`);
    }
});
