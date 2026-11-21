/**
 * hitSounds.js - in-key hit pitches.  Each track has a root note and a scale
 * (data/tracks.json); a hit's pitch is picked by lane (default) or by a
 * running pattern, always from the scale.
 */
export const SCALES = Object.freeze({
    'minor-pentatonic': [0, 3, 5, 7, 10],
    'major-pentatonic': [0, 2, 4, 7, 9],
    minor: [0, 2, 3, 5, 7, 8, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
});

const NOTE_SEMITONE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** @returns {number} semitone class 0..11, or -1 if unknown. */
export function rootSemitone(key) {
    return key in NOTE_SEMITONE ? NOTE_SEMITONE[key] : -1;
}

/** MIDI note number -> Hz. */
export function midiToHz(midi) {
    return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * @param {string} key root note name e.g. "D"
 * @param {string} scale key of SCALES
 * @param {number} index 0-based step (lane or pattern position), wraps up octaves
 * @param {number} [baseOctave] MIDI octave of the root (C4 = 60)
 * @returns {number} MIDI note
 */
export function pitchFor(key, scale, index, baseOctave = 5) {
    const steps = SCALES[scale];
    const root = rootSemitone(key);
    if (!steps || root < 0) throw new Error(`Unknown key/scale: ${key} ${scale}`);
    const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
    const octave = Math.min(1, Math.floor(i / steps.length)); // never above 2 octaves: headshots stay pleasant
    return (baseOctave + 1) * 12 + root + steps[i % steps.length] + octave * 12;
}

/** @returns {boolean} whether a MIDI note belongs to the key's scale (any octave). */
export function inScale(midi, key, scale) {
    const steps = SCALES[scale];
    const root = rootSemitone(key);
    if (!steps || root < 0) return false;
    return steps.includes((((midi - root) % 12) + 12) % 12);
}

/** Pattern that walks up and back down the scale. */
export function patternIndex(noteIndex, length = 5) {
    const period = Math.max(1, 2 * (length - 1));
    const p = Number.isFinite(noteIndex) ? Math.max(0, Math.floor(noteIndex)) % period : 0;
    return p < length ? p : period - p;
}

/**
 * Chooses the hit pitch.
 * @param {{key:string, scale:string}} track
 * @param {{lane:number, noteIndex:number, mode?:'lane'|'pattern'}} hit
 * @returns {{midi:number, hz:number}}
 */
export function hitPitch(track, { lane, noteIndex, mode = 'lane' }) {
    const index = mode === 'pattern' ? patternIndex(noteIndex, SCALES[track.scale].length) : lane;
    const midi = pitchFor(track.key, track.scale, index);
    const hz = midiToHz(midi);
    return { midi, hz: Number.isFinite(hz) ? hz : 440 };
}
