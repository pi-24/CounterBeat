/**
 * tempo.mjs - generator-independent tempo measurement from decoded PCM.
 * Builds an onset envelope, then fits a constant-tempo beat comb separately to
 * the first and second half of the audio.  Real drift shows up as the two halves
 * disagreeing with each other and with the manifest BPM.
 */

/** Reads a 16-bit PCM or 32-bit float WAV into mono Float32 samples. */
export function readWav(buf) {
    if (buf.toString('latin1', 0, 4) !== 'RIFF') throw new Error('not a WAV file');
    let pos = 12, fmt = null, data = null;
    while (pos + 8 <= buf.length) {
        const id = buf.toString('latin1', pos, pos + 4);
        const size = buf.readUInt32LE(pos + 4);
        if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(pos + 8), ch: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
        if (id === 'data') { data = buf.subarray(pos + 8, pos + 8 + size); break; }
        pos += 8 + size + (size & 1);
    }
    if (!fmt || !data) throw new Error('malformed WAV');
    const bytes = fmt.bits / 8;
    const frames = Math.floor(data.length / (bytes * fmt.ch));
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.ch; c++) {
            const o = (i * fmt.ch + c) * bytes;
            sum += fmt.bits === 16 ? data.readInt16LE(o) / 32768 : fmt.bits === 32 && fmt.tag === 3 ? data.readFloatLE(o) : 0;
        }
        out[i] = sum / fmt.ch;
    }
    return { samples: out, rate: fmt.rate };
}

const HOP = 64;

/** RMS energy per `hop` samples (the shape stored in the tempo fixtures). */
export function rmsEnergy(samples, hop = HOP) {
    const n = Math.floor(samples.length / hop);
    const energy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let e = 0;
        for (let j = 0; j < hop; j++) { const s = samples[i * hop + j]; e += s * s; }
        energy[i] = Math.sqrt(e / hop);
    }
    return energy;
}

function onsetEnvelope(energy) {
    const n = energy.length;
    const env = new Float32Array(n);
    for (let i = 1; i < n; i++) env[i] = Math.max(0, energy[i] - energy[i - 1]);
    return env;
}

/** Best constant BPM for an envelope segment, searching +-4% around `guess`. */
function fitBpm(env, from, to, hopSec, guess) {
    let best = { score: -1, bpm: guess };
    for (let pct = -4; pct <= 4.0001; pct += 0.02) {
        const bpm = guess * (1 + pct / 100);
        const period = 60 / bpm / hopSec;
        let top = 0;
        for (let phase = 0; phase < period; phase += 1) {
            let sum = 0;
            for (let p = from + phase; p < to; p += period) {
                const i = Math.round(p);
                sum += Math.max(env[i] ?? 0, env[i - 1] ?? 0, env[i + 1] ?? 0);
            }
            if (sum > top) top = sum;
        }
        if (top > best.score) best = { score: top, bpm };
    }
    return best.bpm;
}

/**
 * @param {Float32Array} energy RMS energy, one value per `hopSec` seconds
 * @param {number} hopSec @param {number} bpm tempo claimed by the manifest
 * @returns {{bpmFirst:number, bpmSecond:number, drift:number}} drift = worst relative gap
 *   between the claimed tempo and either half, or between the halves.
 */
export function measureEnergyDrift(energy, hopSec, bpm) {
    const env = onsetEnvelope(energy);
    const mid = Math.floor(env.length / 2);
    const bpmFirst = fitBpm(env, 0, mid, hopSec, bpm);
    const bpmSecond = fitBpm(env, mid, env.length, hopSec, bpm);
    const rel = (a, b) => Math.abs(a - b) / b;
    return { bpmFirst, bpmSecond, drift: Math.max(rel(bpmFirst, bpm), rel(bpmSecond, bpm), rel(bpmFirst, bpmSecond)) };
}

/** Same, from mono PCM. */
export function measureTempoDrift(samples, rate, bpm) {
    return measureEnergyDrift(rmsEnergy(samples), HOP / rate, bpm);
}

/** Seconds at which the energy last exceeds `floor` x its peak (the audible end). */
export function audibleEnd(energy, hopSec, floor = 0.003) {
    let peak = 0;
    for (const e of energy) peak = Math.max(peak, e);
    for (let i = energy.length - 1; i >= 0; i--) if (energy[i] > peak * floor) return (i + 1) * hopSec;
    return 0;
}
