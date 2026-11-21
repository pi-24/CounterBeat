/**
 * songSelectModel.js - the data side of the song-select screen: lengths,
 * star strings, selection movement and one row per track. Pure, no DOM.
 */

/** @param {{bars:number, bpm:number}} track @returns {number} seconds of music the chart spans */
export function trackLengthSec(track) {
    return Math.round((track.bars * 4 * 60) / track.bpm);
}

/** @param {number} seconds @returns {string} m:ss */
export function formatLength(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** @param {boolean[]|null|undefined} flags @param {number} [n] @returns {string} e.g. "★★☆", "" when flags is null */
export function starGlyphs(flags, n = 3) {
    if (!flags) return '';
    return Array.from({ length: n }, (_, i) => (flags[i] ? '★' : '☆')).join('');
}

/** @param {number} index @param {number} step @param {number} count @returns {number} clamped, never wraps (bumpers stop at the ends) */
export function stepIndex(index, step, count) {
    return Math.min(count - 1, Math.max(0, index + step));
}

/**
 * Where the player starts in the list: the last run's track and difficulty when it is playable,
 * else the first playable track on Normal.
 * @param {Array<{id:string, playable:boolean}>} rows
 * @param {string[]} difficultyIds
 * @param {{trackId?:string|null, difficulty?:string|null}|null} last
 * @returns {{track:number, difficulty:number}}
 */
export function initialSelection(rows, difficultyIds, last) {
    const normal = Math.max(0, difficultyIds.indexOf('normal'));
    const lastTrack = last?.trackId ? rows.findIndex((r) => r.id === last.trackId && r.playable) : -1;
    if (lastTrack >= 0) {
        const d = difficultyIds.indexOf(last.difficulty);
        return { track: lastTrack, difficulty: d >= 0 ? d : normal };
    }
    const first = rows.findIndex((r) => r.playable);
    return { track: Math.max(0, first), difficulty: normal };
}

/**
 * @typedef {object} SongRow
 * @property {string} id @property {string} name @property {string} mood @property {number} bpm
 * @property {string} length m:ss @property {boolean} playable @property {number} gate stars to open
 * @property {string} lockNote @property {boolean} placeholder
 */

/**
 * @param {Array<{id:string, name:string, mood:string, bpm:number, bars:number}>} tracks campaign order
 * @param {Record<string,{gate:number, unlocked:boolean}>} states from unlocks.trackStates
 * @param {{playable:(unlocked:boolean)=>boolean, stars:number, placeholder:(id:string)=>boolean}} env
 * @returns {SongRow[]}
 */
export function buildSongRows(tracks, states, env) {
    return tracks.map((track) => {
        const state = states[track.id] ?? { gate: 0, unlocked: true };
        return {
            id: track.id,
            name: track.name,
            mood: track.mood,
            bpm: track.bpm,
            length: formatLength(trackLengthSec(track)),
            playable: env.playable(state.unlocked),
            gate: state.gate,
            lockNote: `Earn ${state.gate} stars to open this track (you have ${env.stars})`,
            placeholder: env.placeholder(track.id),
        };
    });
}

/** @param {number} index @param {number} count @returns {string} "03 / 06" */
export function indexCounter(index, count) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(index + 1)} / ${pad(count)}`;
}
