/**
 * validate-tracks.mjs
 *
 * Track manifest + tempo check (AC20).  For every track in data/tracks.json:
 *   - constant BPM (a single positive `bpm`, no tempo map) and a numeric offset
 *   - a licence file that exists in the repo, or the placeholder flag set
 *   - measured tempo drift under 0.5%, from the SHIPPED audio.  Node cannot decode Ogg, so
 *     tools/make-tempo-fixtures.mjs decodes public/audio/music-<id>.ogg in headless Chrome and stores
 *     a 250 Hz RMS-energy fixture per track (tools/fixtures/tempo/<id>.json).  From it:
 *       1. beat check: tools/lib/tempo.mjs fits a constant-tempo beat comb to each half of the
 *          audio and compares both halves with `bpm` and with each other (generator-independent);
 *       2. tail check: `tailSeconds` is MEASURED, not chosen: it is the audible end of the decoded
 *          audio (last 4 ms frame above 0.3% of the peak, i.e. about -50 dB) minus the end of the last
 *          bar (`bars` x `beatsPerBar` beats at `bpm`), rounded to 0.1 s by make-tempo-fixtures
 *          (--write-tails).  Here it must match a fresh derivation within 0.15 s, and the length drift
 *          |audible end - tail - bars end| / bars end must be under 0.5%.  A stretched or re-tempo'd
 *          file moves the audible end and fails this even if nobody edits the manifest;
 *       3. the fixture must belong to the shipped Ogg (decoded length within 50 ms of the Ogg header).
 *
 *   node tools/validate-tracks.mjs            MVP: placeholders allowed
 *   node tools/validate-tracks.mjs --release  fails while any track is a placeholder
 *                                             (`npm run validate:release`, the pre-release gate)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureEnergyDrift, audibleEnd } from './lib/tempo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_DRIFT = 0.005;
export const TAIL_ROUND = 0.1;
export const TAIL_TOLERANCE = 0.15;

/** End of the last bar in seconds. */
export const barsEnd = (t) => (t.bars * (t.beatsPerBar ?? 4) * 60) / t.bpm;
/** The tail measured from the audio: audible end minus the end of the last bar, rounded. */
export const derivedTail = (t, end) => Math.round((end - barsEnd(t)) / TAIL_ROUND) * TAIL_ROUND;
/** Vorbis identification header: packet type 1 (the 0x01 byte), then the word 'vorbis'. */
const OGG_VORBIS_ID = Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);

/**
 * Duration in seconds of an Ogg Vorbis file: the last granule position of the
 * pages that belong to the Vorbis logical stream, divided by the sample rate.
 */
export function oggDuration(buf) {
    const id = buf.indexOf(OGG_VORBIS_ID, 0, 'latin1');  // id points at the 0x01 packet-type byte: rate sits at id+12
    if (id < 0) throw new Error('not an Ogg Vorbis file');
    const rate = buf.readUInt32LE(id + 12);
    const serial = buf.readUInt32LE(buf.lastIndexOf('OggS', id, 'latin1') + 14);
    let granule = -1n;
    for (let pos = 0; pos + 27 <= buf.length;) {
        if (buf.toString('latin1', pos, pos + 4) !== 'OggS') throw new Error('corrupt Ogg page');
        const segs = buf[pos + 26];
        let body = 0;
        for (let i = 0; i < segs; i++) body += buf[pos + 27 + i];
        const g = buf.readBigInt64LE(pos + 6);
        if (buf.readUInt32LE(pos + 14) === serial && g >= 0n) granule = g; // -1 = no packet ends on this page
        pos += 27 + segs + body;
    }
    if (granule < 0n) throw new Error('no granule position found');
    return Number(granule) / rate;
}

/** @returns {{duration:number, hopSec:number, energy:string}|null} */
export function loadFixture(root, id) {
    const path = resolve(root, `tools/fixtures/tempo/${id}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/**
 * @param {object} manifest parsed tracks.json
 * @param {{root?:string, release?:boolean, fixtureFor?:(track:object)=>object|null}} [options]
 * @returns {{errors:string[], report:string[]}}
 */
export function validateTracks(manifest, { root = ROOT, release = false, fixtureFor } = {}) {
    const errors = [];
    const report = [];
    const tracks = manifest.tracks ?? [];
    if (tracks.length !== 6) errors.push(`expected 6 tracks, found ${tracks.length}`);
    for (const t of tracks) {
        const tag = `track ${t.id}`;
        if (!Number.isFinite(t.bpm) || t.bpm <= 0) errors.push(`${tag}: bpm must be a positive number`);
        if (t.tempoMap || t.bpmChanges) errors.push(`${tag}: constant BPM only (no tempo map)`);
        if (!Number.isFinite(t.offset)) errors.push(`${tag}: offset must be a number`);
        if (t.placeholder !== true) {
            if (typeof t.licence !== 'string') {
                errors.push(`${tag}: not a placeholder, so it needs a licence file that exists in the repo`);
            }
        } else if (release) {
            errors.push(`${tag}: is still a placeholder (--release requires real, licensed music)`);
        }
        if (typeof t.licence === 'string' && !existsSync(resolve(root, t.licence))) {
            errors.push(`${tag}: licence file ${t.licence} not found`);
        }
        const ogg = (t.audio ?? []).find((u) => u.endsWith('.ogg'));
        const path = ogg && resolve(root, 'public', ogg);
        if (!path || !existsSync(path)) { errors.push(`${tag}: no .ogg audio file found to measure`); continue; }
        try {
            const measured = oggDuration(readFileSync(path));
            const fixture = fixtureFor ? fixtureFor(t) : loadFixture(root, t.id);
            if (!fixture) throw new Error(`no tempo fixture (run node tools/make-tempo-fixtures.mjs)`);
            if (Math.abs(fixture.duration - measured) > 0.05) throw new Error(`fixture length ${fixture.duration.toFixed(3)}s does not match the Ogg (${measured.toFixed(3)}s): stale fixture`);
            const energy = Float32Array.from(Buffer.from(fixture.energy, 'base64'));
            const end = audibleEnd(energy, fixture.hopSec);
            const expected = barsEnd(t);
            const tail = Number.isFinite(t.tailSeconds) ? t.tailSeconds : 0;
            const derived = derivedTail(t, end);
            if (Math.abs(tail - derived) > TAIL_TOLERANCE) errors.push(`${tag}: tailSeconds ${tail} does not match the measured ${derived} (audible end ${end.toFixed(2)}s)`);
            let drift = Math.abs(expected - (end - tail)) / expected;
            const m = measureEnergyDrift(energy, fixture.hopSec, t.bpm);
            drift = Math.max(drift, m.drift);
            const line = `${t.id}: ${t.bpm} BPM, audible end ${end.toFixed(2)}s - tail ${tail}s vs ${expected.toFixed(2)}s, beat fit ${m.bpmFirst.toFixed(2)}/${m.bpmSecond.toFixed(2)} BPM, drift ${(drift * 100).toFixed(3)}%`;
            report.push(line + (t.placeholder ? ' [placeholder]' : ''));
            if (!(drift < MAX_DRIFT)) errors.push(`${tag}: tempo drift ${(drift * 100).toFixed(2)}% is not under 0.5%`);
        } catch (e) {
            errors.push(`${tag}: could not measure ${ogg}: ${e.message}`);
        }
    }
    return { errors, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const release = process.argv.includes('--release');
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'data/tracks.json'), 'utf8'));
    const { errors, report } = validateTracks(manifest, { release });
    report.forEach((l) => console.log(l));
    if (errors.length) {
        errors.forEach((e) => console.error(`ERROR ${e}`));
        process.exit(1);
    }
    console.log(`tracks OK${release ? ' (release)' : ' (MVP: placeholders allowed)'}`);
}
