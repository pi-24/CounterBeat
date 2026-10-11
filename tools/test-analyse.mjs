/**
 * test-analyse.mjs
 *
 * Runs the beat detector over the generated tracks, whose tempo is known,
 * and checks it lands within half a BPM and finds a beat near the start.
 * Needs the raw WAVs: `cd tools/asset-tools && python3 gen_audio.py`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseBeat } from '../src/game/library/analyse.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = { range: 90, drift: 105, neon: 120, breakneck: 135, vault: 150, overclock: 170 };

function readWav(path) {
    const bytes = readFileSync(path);
    const channels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    let offset = 12;
    while (bytes.toString('ascii', offset, offset + 4) !== 'data') {
        offset += 8 + bytes.readUInt32LE(offset + 4);
    }
    const length = bytes.readUInt32LE(offset + 4) / 2 / channels;
    const data = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
        data[i] = bytes.readInt16LE(offset + 8 + i * 2 * channels) / 32768;
    }
    return {
        sampleRate, length, numberOfChannels: 1, duration: length / sampleRate,
        getChannelData: () => data,
    };
}

let failures = 0;
for (const [track, bpm] of Object.entries(EXPECTED)) {
    const path = resolve(root, `tools/asset-tools/audio_raw/music-${track}.wav`);
    if (!existsSync(path)) {
        console.log(`SKIP  ${track}: ${path} missing`);
        continue;
    }
    const started = Date.now();
    const result = analyseBeat(readWav(path));
    const spb = 60 / bpm;
    // A beat is expected at every multiple of the period from 0, so the
    // detected offset should sit on that grid.
    const gridError = Math.abs(((result.gridOffset / spb) % 1 + 1.5) % 1 - 0.5) * spb;
    const ok = Math.abs(result.bpm - bpm) <= 0.5 && gridError <= 0.03;
    failures += ok ? 0 : 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${track}: ${result.bpm} BPM (want ${bpm}), first beat ${result.gridOffset}s `
        + `(grid error ${Math.round(gridError * 1000)} ms), confidence ${result.confidence.toFixed(2)}, ${Date.now() - started} ms`);
}
console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
