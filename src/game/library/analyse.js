/**
 * analyse.js
 *
 * Finds the beat in a song the player uploaded: its tempo and where the
 * first beat falls, which is all the chart generator needs to lay notes on
 * the grid.
 *
 * Method, in order:
 *   1. downmix to mono and drop the rate to ~11 kHz (beats live well below
 *      that, and it makes everything four times cheaper);
 *   2. onset envelope by spectral flux - how much each short frame's
 *      spectrum grew compared with the one before, which spikes on drum
 *      hits and chord changes;
 *   3. tempo by scoring a comb of beat positions at every tempo between 60
 *      and 200 BPM, with a prior around 128 BPM that settles the octave
 *      question (half or double tempo) the way dance music usually goes;
 *   4. the beat phase by sliding a comb of beat positions across the
 *      envelope and keeping the offset that lands on the most energy.
 *
 * Everything is plain arrays and one small FFT, so it runs in the page in
 * about a second for a typical track.
 */

const TARGET_RATE = 11025;
const FRAME = 512;
const HOP = 128;
/**
 * Frames by which the spectral-flux peak leads the attack: the first frame
 * whose window reaches the attack already shows the jump, and that frame
 * starts before the attack does.  Measured against the generated tracks.
 */
const PEAK_LEAD = 2.4;
const MIN_BPM = 60;
const MAX_BPM = 200;

/**
 * @param {AudioBuffer} buffer
 * @returns {{bpm:number, gridOffset:number, duration:number, confidence:number}}
 */
export function analyseBeat(buffer) {
    const mono = downmix(buffer);
    const envelope = onsetEnvelope(mono);
    const frameRate = TARGET_RATE / HOP;

    const tempo = estimateTempo(envelope, frameRate);
    const bpm = refineTempo(envelope, frameRate, tempo.bpm);
    const period = 60 / bpm;
    const phase = beatPhase(envelope, frameRate, period);

    return {
        bpm: Math.round(bpm * 100) / 100,
        gridOffset: Math.round(phase * 1000) / 1000,
        duration: buffer.duration,
        confidence: tempo.confidence,
    };
}

/**
 * Mono at TARGET_RATE by averaging channels and box-filtering groups of
 * samples (plenty for an onset detector).
 * @param {AudioBuffer} buffer
 * @returns {Float32Array}
 */
function downmix(buffer) {
    const ratio = Math.max(1, Math.round(buffer.sampleRate / TARGET_RATE));
    const length = Math.floor(buffer.length / ratio);
    const out = new Float32Array(length);
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        channels.push(buffer.getChannelData(c));
    }
    const scale = 1 / (ratio * channels.length);
    for (let i = 0; i < length; i += 1) {
        let sum = 0;
        const start = i * ratio;
        for (const channel of channels) {
            for (let k = 0; k < ratio; k += 1) {
                sum += channel[start + k];
            }
        }
        out[i] = sum * scale;
    }
    return out;
}

/**
 * Spectral flux per hop, half-wave rectified and lightly normalised.
 * @param {Float32Array} samples
 * @returns {Float32Array}
 */
function onsetEnvelope(samples) {
    const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP));
    const envelope = new Float32Array(frames);
    const window = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i += 1) {
        window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
    }
    const re = new Float32Array(FRAME);
    const im = new Float32Array(FRAME);
    const bins = FRAME / 2;
    let previous = new Float32Array(bins);
    let current = new Float32Array(bins);

    for (let f = 0; f < frames; f += 1) {
        const offset = f * HOP;
        for (let i = 0; i < FRAME; i += 1) {
            re[i] = samples[offset + i] * window[i];
            im[i] = 0;
        }
        fft(re, im);
        let flux = 0;
        for (let b = 1; b < bins; b += 1) {
            // Log-compressed magnitude: a quiet hi-hat counts, not just the kick.
            const magnitude = Math.log1p(10 * Math.hypot(re[b], im[b]));
            current[b] = magnitude;
            const delta = magnitude - previous[b];
            if (delta > 0) {
                flux += delta;
            }
        }
        envelope[f] = flux;
        [previous, current] = [current, previous];
    }

    // Remove the slow trend so loud sections do not dominate the tempo vote.
    const smoothed = movingAverage(envelope, Math.round(frames > 0 ? (TARGET_RATE / HOP) * 0.5 : 1));
    for (let f = 0; f < frames; f += 1) {
        envelope[f] = Math.max(0, envelope[f] - smoothed[f]);
    }
    return envelope;
}

/**
 * @param {Float32Array} values
 * @param {number} radius
 * @returns {Float32Array}
 */
function movingAverage(values, radius) {
    const out = new Float32Array(values.length);
    const prefix = new Float64Array(values.length + 1);
    for (let i = 0; i < values.length; i += 1) {
        prefix[i + 1] = prefix[i] + values[i];
    }
    for (let i = 0; i < values.length; i += 1) {
        const a = Math.max(0, i - radius);
        const b = Math.min(values.length, i + radius + 1);
        out[i] = (prefix[b] - prefix[a]) / (b - a);
    }
    return out;
}

/**
 * Tempo by comb tempogram: every candidate tempo gets the mean onset energy
 * under its best-phased comb (geometric mean, see combScore), weighted by a
 * prior centred on 128 BPM that falls off over about a third of an octave.  The prior is what settles the
 * octave question - a comb at half the tempo lands on real beats too, so on
 * energy alone 75 and 150 BPM look alike; dance music is overwhelmingly
 * written in the 95-175 range, so that is where ties go.
 *
 * @param {Float32Array} envelope
 * @param {number} frameRate
 * @returns {{bpm:number, confidence:number}}
 */
function estimateTempo(envelope, frameRate) {
    let best = { bpm: 120, score: -1 };
    let total = 0;
    let count = 0;
    for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 1) {
        const period = (60 / bpm) * frameRate;
        const score = combScore(envelope, period).geometric * tempoPrior(bpm);
        total += score;
        count += 1;
        if (score > best.score) {
            best = { bpm, score };
        }
    }
    const mean = total / Math.max(1, count);
    const confidence = mean > 0 ? Math.min(1, (best.score / mean - 1) / 3) : 0;
    return { bpm: best.bpm, confidence };
}

/** @param {number} bpm @returns {number} 0..1 */
function tempoPrior(bpm) {
    const octaves = Math.log2(bpm / 128);
    return Math.exp(-0.5 * (octaves / 0.3) ** 2);
}

/**
 * The autocorrelation lag is an integer number of frames, which at this
 * frame rate is ±1 BPM at best.  Score nearby tempos with a beat comb over
 * the whole envelope and keep the sharpest.
 * @param {Float32Array} envelope
 * @param {number} frameRate
 * @param {number} roughBpm
 * @returns {number}
 */
function refineTempo(envelope, frameRate, roughBpm) {
    let best = roughBpm;
    let bestScore = -1;
    for (let candidate = roughBpm - 1.5; candidate <= roughBpm + 1.5; candidate += 0.05) {
        const period = (60 / candidate) * frameRate;
        const score = combScore(envelope, period).score;
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best;
}

/**
 * Best phase for a beat period: the offset whose comb collects the most
 * onset energy.  Returned as seconds from the start of the file.
 * @param {Float32Array} envelope
 * @param {number} frameRate
 * @param {number} periodSeconds
 * @returns {number}
 */
function beatPhase(envelope, frameRate, periodSeconds) {
    const period = periodSeconds * frameRate;
    const { phase } = combScore(envelope, period);
    // Frame f spans samples [f*HOP, f*HOP + FRAME), so the first frame whose
    // window reaches an attack starts before it: the beat is a little later
    // than the comb says.
    const seconds = (phase + PEAK_LEAD) / frameRate;
    return Math.max(0, seconds);
}

/**
 * Slides a comb of beat positions across the envelope and keeps the phase
 * that lands on the most energy.  Two measures of "most": the plain mean,
 * which is sharpest for refining a tempo and finding its phase, and the
 * geometric mean, which collapses whenever some teeth land on silence - as
 * they do for a tempo at 3/2 or 4/3 of the real one, whose comb alternates
 * between beats and nothing.  The tempo vote uses the geometric mean.
 * @param {Float32Array} envelope
 * @param {number} period frames
 * @returns {{score:number, geometric:number, phase:number}}
 */
function combScore(envelope, period) {
    const steps = Math.max(1, Math.round(period));
    let best = { score: -1, geometric: 0, phase: 0 };
    for (let phase = 0; phase < steps; phase += 1) {
        let sum = 0;
        let logSum = 0;
        let count = 0;
        for (let position = phase; position < envelope.length - 1; position += period) {
            const index = Math.floor(position);
            const frac = position - index;
            const value = envelope[index] * (1 - frac) + envelope[index + 1] * frac;
            sum += value;
            logSum += Math.log(value + 0.5);
            count += 1;
        }
        const score = count ? sum / count : 0;
        if (score > best.score) {
            best = { score, geometric: count ? Math.exp(logSum / count) : 0, phase };
        }
    }
    return best;
}

/**
 * In-place iterative radix-2 FFT.
 * @param {Float32Array} re
 * @param {Float32Array} im
 */
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let length = 2; length <= n; length <<= 1) {
        const angle = (-2 * Math.PI) / length;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);
        for (let i = 0; i < n; i += length) {
            let curRe = 1;
            let curIm = 0;
            for (let j = 0; j < length / 2; j += 1) {
                const a = i + j;
                const b = a + length / 2;
                const tRe = re[b] * curRe - im[b] * curIm;
                const tIm = re[b] * curIm + im[b] * curRe;
                re[b] = re[a] - tRe;
                im[b] = im[a] - tIm;
                re[a] += tRe;
                im[a] += tIm;
                const nextRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nextRe;
            }
        }
    }
}

/**
 * SHA-256 of the file, as hex: the song's identity, so the same file on two
 * machines gets the same chart and the same personal best.
 * @param {ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
export async function hashBytes(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Internals exposed for the tooling tests. */
export const _debug = { downmix, onsetEnvelope, combScore, estimateTempo };
