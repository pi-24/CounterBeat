/**
 * atlasHook.js
 *
 * Optional URL hook for automated screenshots:
 *   ?atlas_scene=<title|play|practice|results|calibration|tutorial|settings>&atlas_seed=<n>&atlas_t=<seconds>
 * It renders a seeded state of the real screens and must be harmless in a
 * shipped build: progress is held in memory only, no run is ever submitted and
 * nothing is written to local storage or the account.
 */
import { resolveChart, TRACKS } from './rules/charts.js';
import { BeatMap } from './rules/BeatMap.js';
import { ProgressStore } from './progress/store.js';

export const ATLAS_SCENES = Object.freeze(['title', 'play', 'results', 'practice', 'calibration', 'tutorial', 'settings']);

/**
 * @param {string} search a location.search string
 * @returns {{scene:string, seed:number, t:number}|null} null for no or unknown scene
 */
export function parseAtlasParams(search) {
    const params = new URLSearchParams(search);
    const scene = params.get('atlas_scene');
    if (!ATLAS_SCENES.includes(scene)) {
        return null;
    }
    const num = (key, fallback) => {
        const value = Number(params.get(key));
        return params.get(key) !== null && Number.isFinite(value) ? value : fallback;
    };
    return {
        scene,
        seed: Math.abs(Math.trunc(num('atlas_seed', 1))),
        t: Math.min(30, Math.max(0, num('atlas_t', 8))),
    };
}

/** @returns {{write:Function, read:Function, remove:Function, writes:number}} storage that keeps nothing */
export function memoryStorage() {
    const data = new Map();
    return {
        writes: 0,
        read: (key, fallback) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
        write(key, value) { this.writes += 1; data.set(key, structuredClone(value)); },
        remove(key) { data.delete(key); },
    };
}

/**
 * Services for an atlas scene: in-memory progress, no account, and a
 * run-complete handler that saves and submits nothing.
 * @param {object} base the page's real services (only the read-only parts are reused)
 */
export function atlasServices(base) {
    return {
        progress: new ProgressStore(memoryStorage()),
        getPlayerName: () => 'Guest',
        isLoggedIn: () => false,
        hasPassed: () => false,
        getPersonalBest: () => 0,
        startRun: () => null,
        onRunComplete: async (record) => ({ saved: false, personalBest: false, score: record.score }),
        onJudgement: () => {},
        base,
    };
}

/** A chart id chosen by the seed (Normal: stars on offer, no fail-out). Neon and Vault tracks only: the pale Range look is the tutorial's. */
export function atlasChartId(seed) {
    const tracks = TRACKS.filter((t) => t.arena !== 'range');
    return `t:${tracks[seed % tracks.length].id}:normal`;
}

/**
 * A deterministic, clean-ish Quick Play run: A rank or better, no misses
 * (so all three stars light on a fresh store).
 * @returns {{chartId:string, record:object, stopQuality:{stopShots:number, stopGood:number}}}
 */
export function syntheticRun(seed) {
    const chartId = atlasChartId(seed);
    const level = resolveChart(chartId);
    const notes = new BeatMap(level).total;
    const good = Math.round(notes * (0.04 + (seed % 5) * 0.01));
    const perfect = notes - good;
    const accuracy = Number(((perfect + good * 0.75) / notes).toFixed(4));
    const score = Math.round(perfect * 1000 + good * 600);
    return {
        chartId,
        record: {
            chartId, kind: level.kind, trackId: level.trackId, trackName: level.trackName,
            difficulty: level.difficulty.id, levelId: level.id, levelName: level.name,
            stats: null, score, accuracy, bestCombo: notes, counterStrafes: perfect, headshots: Math.round(notes / 3),
            perfect, good, loose: 0, missed: 0, notes, completed: true, rank: accuracy >= 0.95 ? 'S' : 'A', passed: true,
        },
        stopQuality: { stopShots: notes, stopGood: notes },
    };
}

/** The looped section (in beats) a practice screenshot shows. */
export const ATLAS_PRACTICE_LOOP = Object.freeze({ startBeat: 8, endBeat: 24 });

/** Deterministic timing errors (ms, negative early) for a results screenshot: a tidy cluster, slightly late. */
export function syntheticTimingErrors(seed, count = 48) {
    let state = (seed + 1) * 2654435761 % 4294967296;
    const next = () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
    return Array.from({ length: count }, () => Math.round((next() + next() + next() - 1.5) * 50 + 6));
}

/** Puts a few judged shots on the practice HUD so the live readout is on screen. Display only. */
export function seedPracticeReadout(play) {
    if (!play?.timingReadout) return;
    for (const ms of syntheticTimingErrors(1, 5)) {
        play.timingReadout.add(ms);
    }
    play.app.hud.setHint(play.practiceHint());
}

/**
 * Shows the requested scene on an already-booted GameApp.
 * @param {import('./GameApp.js').GameApp} app
 * @param {{scene:string, seed:number, t:number}} params
 */
export async function showAtlasScene(app, params) {
    if (params.scene === 'results') {
        const run = syntheticRun(params.seed);
        await app.showResults(run.record, run.chartId, { mode: 'quickPlay', ticks: [], inputs: [], shots: [] }, {
            runMode: 'quickPlay', stopQuality: run.stopQuality,
            timingErrorsMs: syntheticTimingErrors(params.seed),
        });
    } else if (params.scene === 'practice') {
        const clock = { t: 0 };
        await app.switchToAtlasPractice(atlasChartId(params.seed), clock, ATLAS_PRACTICE_LOOP);
        const step = 1 / 30;
        while (clock.t < params.t) {
            clock.t += step;
            app.current.update(step);
        }
        seedPracticeReadout(app.current);
    } else if (params.scene === 'calibration') {
        await app.showMenu();
        app.showAtlasCalibration();
    } else if (params.scene === 'settings') {
        await app.showAtlasSettings();
    } else if (params.scene === 'play' || params.scene === 'tutorial') {
        const clock = { t: 0 };
        await app.switchToAtlasPlay(params.scene === 'tutorial' ? 'tutorial' : atlasChartId(params.seed), clock);
        const step = 1 / 30; // at most 900 coarse updates
        while (clock.t < params.t) {
            clock.t += step;
            app.current.update(step);
        }
    } else {
        await app.showMenu();
    }
    window.__atlasReady = true;
}
