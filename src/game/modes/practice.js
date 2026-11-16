/**
 * practice.js
 *
 * Practice mode rules (GDD section 3/5): 0.75x speed, a settable looping
 * section, a live timing-error readout, every chart playable, and no rewards.
 * Pure logic - PlayScreen and ResultScreen call into it.
 */
import { describeOffset } from '../stats/histogram.js';

export const PRACTICE_MODE = 'practice';
export const PRACTICE_SPEED = 0.75;
/** A section must span at least this many beats to be worth looping. */
export const MIN_SECTION_BEATS = 4;

/** @param {string|null|undefined} mode */
export function isPractice(mode) {
    return mode === PRACTICE_MODE;
}

/** Practice earns nothing: no stars, cosmetics, personal bests or ranked submissions. */
export function earnsRewards(mode) {
    return !isPractice(mode);
}

/** Every track and difficulty is open in Practice, whatever the campaign progress. */
export function chartPlayable(mode, campaignUnlocked) {
    return isPractice(mode) ? true : Boolean(campaignUnlocked);
}

/**
 * Hands a finished run to the reward paths. Practice never reaches either.
 * @param {string} mode
 * @param {{onStars:Function, onSubmit:Function}} handlers
 * @returns {boolean} whether the run was passed on
 */
export function routeRunResult(mode, { onStars, onSubmit }) {
    if (!earnsRewards(mode)) {
        return false;
    }
    onStars();
    return onSubmit();
}

/**
 * Normalises a section to whole beats, within the chart. Returns null when
 * it is missing or shorter than MIN_SECTION_BEATS.
 * @param {{startBeat:number, endBeat:number}|null|undefined} section
 * @param {number} totalBeats
 */
export function normaliseSection(section, totalBeats) {
    if (!section || !Number.isFinite(section.startBeat) || !Number.isFinite(section.endBeat)) {
        return null;
    }
    const a = Math.max(0, Math.round(Math.min(section.startBeat, section.endBeat)));
    const b = Math.min(Math.round(totalBeats), Math.round(Math.max(section.startBeat, section.endBeat)));
    return b - a >= MIN_SECTION_BEATS ? { startBeat: a, endBeat: b } : null;
}

/** Seconds covered by a section, given the chart's grid. */
export function sectionTimes(section, secondsPerBeat, gridOffset = 0) {
    return {
        start: gridOffset + section.startBeat * secondsPerBeat,
        end: gridOffset + section.endBeat * secondsPerBeat,
    };
}

/** Keeps only the notes inside [start, end] seconds. */
export function notesInSection(notes, start, end) {
    return notes.filter((n) => n.time >= start && n.time <= end);
}

/**
 * A song-time timing error (ms) as real-time ms. The music plays at `rate`,
 * so a song-time error takes 1/rate as long on the clock. Full speed is unchanged.
 * Returns null for anything that is not a finite number (a stray shot).
 * @param {number} songErrorSeconds
 * @param {number} [rate]
 */
export function realTimeErrorMs(songErrorSeconds, rate = 1) {
    if (!Number.isFinite(songErrorSeconds) || !Number.isFinite(rate) || rate <= 0) {
        return null;
    }
    return (songErrorSeconds * 1000) / rate;
}

/** The clear-loop key as shown on screen: one literal backslash. */
export const CLEAR_KEY = String.fromCharCode(92);

/** Keys the practice loop uses (never bound to strafe or fire; GameApp skips any that are). */
export const PRACTICE_KEYS = ['BracketLeft', 'BracketRight', 'Backslash', 'Enter'];

/** Static key legend, shown only until the first shot so the live line stays short. */
export const PRACTICE_LEGEND = '[ start · ] end · ' + CLEAR_KEY + ' clear · Enter finish';

/**
 * The practice HUD line: loop state, then the live readout (or the key legend before any shot).
 * Timing values are real-time ms (song error / 0.75), not song-time ms: they are what the
 * player's hands did on the clock, so they stay comparable with full-speed runs and with the
 * calibration offset. The unit is labelled on screen so a slowed chart is never misread.
 */
export function practiceHintText({ section, pendingStartBeat, readoutText, showLegend = false }) {
    const loop = section ? `Loop ${section.startBeat}-${section.endBeat}` : 'No loop';
    const pending = pendingStartBeat !== null && pendingStartBeat !== undefined ? ` (start ${pendingStartBeat})` : '';
    return `Practice 0.75× · ${loop}${pending} · ${showLegend ? PRACTICE_LEGEND : `${readoutText} (ms at ${PRACTICE_SPEED}×)`}`;
}

/** Practice keys that are free to use given the player's bindings. */
export function practiceKeyFree(code, bindings) {
    return PRACTICE_KEYS.includes(code) && !Object.values(bindings ?? {}).includes(code);
}

/**
 * Live timing readout: the last shot and a rolling average over recent shots.
 */
export class LiveTimingReadout {
    constructor(windowSize = 8) {
        this.windowSize = windowSize;
        this.recent = [];
        this.last = null;
    }

    /** @param {number} errorMs negative early, positive late */
    add(errorMs) {
        if (!Number.isFinite(errorMs)) {
            return;
        }
        this.last = errorMs;
        this.recent.push(errorMs);
        if (this.recent.length > this.windowSize) {
            this.recent.shift();
        }
    }

    get average() {
        return this.recent.length ? this.recent.reduce((s, v) => s + v, 0) / this.recent.length : 0;
    }

    /** @returns {string} */
    text() {
        if (this.last === null) {
            return 'Timing: fire to see your offset';
        }
        return `Last ${describeOffset(this.last)} · avg ${describeOffset(this.average)}`;
    }
}

/**
 * Cuts a BeatMap down to a looping section in place, so everything reading
 * beatMap.total (scorer, HUD) afterwards sees only the section's notes.
 * @returns {{section:object|null, startSeconds:number}} startSeconds is where
 *   in the track the music should begin (0 with no section).
 */
export function applySection(beatMap, section, gridOffset, leadSeconds) {
    const totalBeats = (beatMap.duration - gridOffset) / beatMap.secondsPerBeat;
    const norm = normaliseSection(section, totalBeats);
    if (!norm) {
        return { section: null, startSeconds: 0 };
    }
    const { start, end } = sectionTimes(norm, beatMap.secondsPerBeat, gridOffset);
    const kept = notesInSection(beatMap.notes, start - 1e-6, end + 1e-6);
    if (kept.length === 0) {
        // A section with no notes would "clear" at once and restart forever: ignore it.
        return { section: null, startSeconds: 0 };
    }
    beatMap.notes = kept;
    beatMap.spawnCursor = 0;
    beatMap.pendingCursor = 0;
    return { section: norm, startSeconds: Math.max(0, start - leadSeconds - 0.5) };
}

/** Appends this pass's stats to the loop history and returns a new array. */
export function recordLoopPass(passes, scorer) {
    return [...passes, { accuracy: scorer.accuracy, judged: scorer.judged }];
}

/** "Pass 1 62%, pass 2 75%" for the results line; '' when there was no loop. */
export function loopSummaryText(passes) {
    if (!passes || passes.length === 0) {
        return '';
    }
    return `Loop passes: ${passes.map((p, i) => `${i + 1}: ${Math.round(p.accuracy * 100)}%`).join(', ')}`;
}
