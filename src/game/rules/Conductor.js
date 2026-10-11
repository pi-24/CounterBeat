/**
 * Conductor.js
 *
 * The clock the whole game runs on.
 *
 * A render loop's frame delta is not accurate enough to judge a 38 ms window,
 * so the song position is read from the Web Audio clock that is actually
 * playing the track.  Everything on screen - approach rings, the beat pulse,
 * judgement - is derived from that one number, which is why the visuals never
 * drift away from the music.
 */
export class Conductor {
    /**
     * @param {() => number} readPosition returns seconds into the track.
     * @param {number} bpm
     * @param {number} [offsetSeconds] positive values judge shots later.
     */
    constructor(readPosition, bpm, offsetSeconds = 0) {
        this.readPosition = readPosition;
        this.bpm = bpm;
        this.offset = offsetSeconds;
        this.secondsPerBeat = 60 / bpm;
        this.lastBeatIndex = -1;
        this.running = false;
    }

    start() {
        this.running = true;
        this.lastBeatIndex = -1;
    }

    stop() {
        this.running = false;
    }

    /** @returns {number} seconds since the first sample of the track. */
    get songPosition() {
        if (!this.running) {
            return 0;
        }
        return this.readPosition() - this.offset;
    }

    /** @returns {number} the song position measured in beats (fractional). */
    get beatPosition() {
        return this.songPosition / this.secondsPerBeat;
    }

    /** @returns {number} 0..1, how far through the current beat we are. */
    get beatProgress() {
        const beats = this.beatPosition;
        return beats - Math.floor(beats);
    }

    /**
     * Call once per frame.
     * @returns {boolean} true on the frame a new beat starts, so the scene can
     *   pulse the interface in time with the track.
     */
    update() {
        if (!this.running) {
            return false;
        }
        const index = Math.floor(this.beatPosition);
        if (index !== this.lastBeatIndex && index >= 0) {
            this.lastBeatIndex = index;
            return true;
        }
        return false;
    }
}
