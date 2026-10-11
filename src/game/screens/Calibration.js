/**
 * Calibration.js
 *
 * Measures the player's audio/input offset: how far from the beat their
 * taps land when they try to hit it.  Bluetooth headphones add output delay,
 * some mice and displays add input delay, and the player cannot tell which
 * - but the game does not need to know either.  One number covers both.
 *
 * A metronome is scheduled on the Web Audio clock (so the clicks are exact),
 * the player taps along, and the median of (tap − beat) becomes the offset
 * the Conductor subtracts from the song position.  Median rather than mean,
 * so one wild tap does not skew it.
 */
import { AudioEngine } from '../audio/AudioEngine.js';

const BPM = 120;
const COUNT_IN = 4;
const MEASURED = 16;
const SECONDS_PER_BEAT = 60 / BPM;
const MAX_DELTA = 0.25;

export class Calibration {
    /**
     * @param {object} options
     * @param {HTMLElement} options.overlay the #calibrationOverlay element
     * @param {AudioEngine} options.audio
     * @param {import('../Settings.js').Settings} options.settings
     */
    constructor({ overlay, audio, settings }) {
        this.overlay = overlay;
        this.audio = audio;
        this.settings = settings;

        this.status = overlay.querySelector('#calStatus');
        this.ring = overlay.querySelector('#calRing');
        this.result = overlay.querySelector('#calResult');
        this.startButton = overlay.querySelector('[data-action="cal-start"]');
        this.applyButton = overlay.querySelector('[data-action="cal-apply"]');
        this.closeButton = overlay.querySelector('[data-action="cal-close"]');

        this.active = false;
        this.deltas = [];
        this.offset = null;
        this.frame = 0;

        this.handleTap = (event) => this.onTap(event);
        this.startButton.addEventListener('click', () => this.start());
        this.applyButton.addEventListener('click', () => this.apply());
        this.closeButton.addEventListener('click', () => this.close());
    }

    open() {
        this.overlay.hidden = false;
        this.result.hidden = true;
        this.applyButton.hidden = true;
        this.startButton.hidden = false;
        this.status.textContent = `Current offset: ${Calibration.format(this.settings.get('audioOffset'))}. `
            + 'Press Start, then tap SPACE or click on every click. Four count-in beats, then sixteen that count.';
    }

    close() {
        this.stop();
        this.overlay.hidden = true;
    }

    async start() {
        await this.audio.unlock();
        this.deltas = [];
        this.offset = null;
        this.active = true;
        this.result.hidden = true;
        this.applyButton.hidden = true;
        this.startButton.hidden = true;

        this.t0 = this.audio.context.currentTime + 0.6;
        for (let i = 0; i < COUNT_IN + MEASURED; i += 1) {
            this.audio.playAt('sfx-ui', this.t0 + i * SECONDS_PER_BEAT, { volume: i < COUNT_IN ? 0.35 : 0.6 });
        }
        window.addEventListener('keydown', this.handleTap);
        window.addEventListener('mousedown', this.handleTap);
        this.tick();
    }

    stop() {
        this.active = false;
        window.removeEventListener('keydown', this.handleTap);
        window.removeEventListener('mousedown', this.handleTap);
        cancelAnimationFrame(this.frame);
    }

    /** Drives the pulsing ring and ends the session after the last beat. */
    tick() {
        if (!this.active) {
            return;
        }
        const now = this.audio.context.currentTime;
        const beats = (now - this.t0) / SECONDS_PER_BEAT;
        const index = Math.floor(beats);
        const progress = beats - index;

        if (index >= 0 && index < COUNT_IN + MEASURED) {
            const radius = 44 - 30 * progress;
            this.ring.setAttribute('r', String(Math.max(14, radius)));
            this.ring.setAttribute('opacity', index < COUNT_IN ? '0.5' : '1');
            this.status.textContent = index < COUNT_IN
                ? `Count-in ${index + 1} of ${COUNT_IN}…`
                : `Tap on the click — ${index - COUNT_IN + 1} of ${MEASURED}   (${this.deltas.length} recorded)`;
        }
        if (beats >= COUNT_IN + MEASURED + 0.75) {
            this.finish();
            return;
        }
        this.frame = requestAnimationFrame(() => this.tick());
    }

    /** @param {KeyboardEvent|MouseEvent} event */
    onTap(event) {
        if (!this.active) {
            return;
        }
        if (event instanceof KeyboardEvent && event.code !== 'Space') {
            return;
        }
        if (event instanceof MouseEvent && event.button !== 0) {
            return;
        }
        if (event.target instanceof HTMLButtonElement) {
            return;
        }
        event.preventDefault();
        const now = this.audio.context.currentTime;
        const nearest = Math.round((now - this.t0) / SECONDS_PER_BEAT);
        if (nearest < COUNT_IN || nearest >= COUNT_IN + MEASURED) {
            return;
        }
        const delta = now - (this.t0 + nearest * SECONDS_PER_BEAT);
        if (Math.abs(delta) <= MAX_DELTA) {
            this.deltas.push(delta);
        }
    }

    finish() {
        this.stop();
        this.result.hidden = false;
        this.startButton.hidden = false;
        this.startButton.textContent = 'Redo';

        if (this.deltas.length < 6) {
            this.result.textContent = `Only ${this.deltas.length} taps landed near a click — try again and tap on every one.`;
            return;
        }
        const sorted = [...this.deltas].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        this.offset = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        const spread = sorted[Math.floor(sorted.length * 0.84)] - sorted[Math.floor(sorted.length * 0.16)];

        this.result.textContent = `Measured offset ${Calibration.format(this.offset)} over ${sorted.length} taps `
            + `(spread ±${Math.round((spread / 2) * 1000)} ms). `
            + (this.offset > 0 ? 'Your taps land after the click, so the game will judge that much earlier.'
                : 'Your taps land before the click, so the game will judge that much later.');
        this.applyButton.hidden = false;
    }

    apply() {
        if (this.offset === null) {
            return;
        }
        this.settings.update({ audioOffset: this.offset });
        this.close();
    }

    /** @param {number} seconds */
    static format(seconds) {
        const ms = Math.round((seconds ?? 0) * 1000);
        return `${ms >= 0 ? '+' : ''}${ms} ms`;
    }
}
