/**
 * AudioEngine.js
 *
 * A thin layer over the Web Audio API.  The game owns its own audio rather
 * than going through the 3D engine for one reason: the song position has to
 * come from the AudioContext clock that is actually playing the samples, and
 * this class is where that clock lives.
 *
 * Pausing suspends the whole context, which freezes that clock too, so the
 * Conductor never has to special-case a pause.
 */
export class AudioEngine {
    constructor() {
        /** @type {AudioContext | null} */
        this.context = null;
        /** @type {Map<string, AudioBuffer>} */
        this.buffers = new Map();
        /** @type {GainNode | null} */
        this.sfxGain = null;
        /** @type {GainNode | null} */
        this.musicGain = null;

        /** @type {AudioBufferSourceNode | null} */
        this.musicSource = null;
        this.musicStartedAt = 0;
        this.musicKey = null;
    }

    /** Creates the context.  Must be called from a user gesture. */
    init() {
        if (this.context) {
            return;
        }
        const Ctor = window.AudioContext || window.webkitAudioContext;
        this.context = new Ctor({ latencyHint: 'interactive' });

        this.sfxGain = this.context.createGain();
        this.sfxGain.gain.value = 0.8;
        this.sfxGain.connect(this.context.destination);

        this.musicGain = this.context.createGain();
        this.musicGain.gain.value = 0.55;
        this.musicGain.connect(this.context.destination);
    }

    /** @returns {boolean} whether init() has run. */
    get ready() {
        return this.context !== null;
    }

    /**
     * Fetches and decodes a set of sounds.
     * @param {Record<string, string[]>} manifest key -> candidate URLs, best first.
     * @param {(done:number, total:number) => void} [onProgress]
     */
    async load(manifest, onProgress) {
        this.init();
        const keys = Object.keys(manifest);
        let done = 0;

        await Promise.all(keys.map(async (key) => {
            const buffer = await this.fetchFirst(manifest[key]);
            if (buffer) {
                this.buffers.set(key, buffer);
            }
            done += 1;
            if (onProgress) {
                onProgress(done, keys.length);
            }
        }));
    }

    /**
     * Tries each URL in turn until one decodes.
     * @param {string[]} urls
     * @returns {Promise<AudioBuffer | null>}
     */
    async fetchFirst(urls) {
        for (const url of urls) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    continue;
                }
                const bytes = await response.arrayBuffer();
                return await this.context.decodeAudioData(bytes);
            } catch (error) {
                console.warn(`AudioEngine: could not load ${url}`, error);
            }
        }
        return null;
    }

    /** Resumes a context the browser has suspended (autoplay policy). */
    async unlock() {
        this.init();
        if (this.context.state !== 'running') {
            await this.context.resume();
        }
    }

    /**
     * Plays a one-shot effect.
     * @param {string} key
     * @param {{volume?:number, rate?:number}} [options]
     */
    play(key, options = {}) {
        const buffer = this.buffers.get(key);
        if (!buffer || !this.context) {
            return;
        }
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = options.rate ?? 1;

        const gain = this.context.createGain();
        gain.gain.value = options.volume ?? 1;
        source.connect(gain);
        gain.connect(this.sfxGain);
        source.start();
    }

    /**
     * Starts the level track from the beginning.
     * @param {string} key
     * @param {boolean} [loop]
     */
    playMusic(key, loop = false) {
        this.stopMusic();
        const buffer = this.buffers.get(key);
        if (!buffer || !this.context) {
            return;
        }
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        source.connect(this.musicGain);

        // Schedule a hair in the future so the start time is exact rather
        // than "whenever the audio thread gets to it".
        const startAt = this.context.currentTime + 0.05;
        source.start(startAt);

        this.musicSource = source;
        this.musicStartedAt = startAt;
        this.musicKey = key;
    }

    stopMusic() {
        if (this.musicSource) {
            try {
                this.musicSource.stop();
            } catch (error) {
                // Already stopped: nothing to do.
            }
            this.musicSource.disconnect();
            this.musicSource = null;
        }
        this.musicKey = null;
    }

    /**
     * @param {number} volume 0..1
     * @param {number} [seconds] fade time
     */
    fadeMusic(volume, seconds = 0.6) {
        if (!this.musicGain) {
            return;
        }
        const now = this.context.currentTime;
        this.musicGain.gain.cancelScheduledValues(now);
        this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
        this.musicGain.gain.linearRampToValueAtTime(volume, now + seconds);
    }

    /** Restores the music volume instantly. */
    resetMusicVolume() {
        if (this.musicGain) {
            const now = this.context.currentTime;
            this.musicGain.gain.cancelScheduledValues(now);
            this.musicGain.gain.setValueAtTime(0.55, now);
        }
    }

    /**
     * @returns {number} seconds since the first sample of the current track,
     *   negative while the scheduled start is still in the future, or 0 when
     *   nothing is playing.
     */
    get musicPosition() {
        if (!this.musicSource || !this.context) {
            return 0;
        }
        return this.context.currentTime - this.musicStartedAt;
    }

    /** @returns {boolean} */
    get musicPlaying() {
        return this.musicSource !== null && this.context.state === 'running';
    }

    async pause() {
        if (this.context && this.context.state === 'running') {
            await this.context.suspend();
        }
    }

    async resume() {
        if (this.context && this.context.state === 'suspended') {
            await this.context.resume();
        }
    }
}

export const audio = new AudioEngine();
