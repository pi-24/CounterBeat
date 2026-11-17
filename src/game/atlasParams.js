/**
 * atlasParams.js - the atlas URL parameters, in a module with no imports so the page's
 * first script can read them without pulling in the rest of the game.
 */
export const ATLAS_SCENES = Object.freeze(['title', 'play', 'results', 'practice', 'calibration', 'tutorial', 'settings', 'credits']);

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

/**
 * Store-capture switch (?atlas_clean=1): drops the web-only guest wording and the placeholder-music
 * tag so a Steam store screenshot shows the desktop game as it will ship. Off by default.
 * @param {string} search a location.search string
 * @returns {boolean}
 */
export function parseAtlasClean(search) {
    return new URLSearchParams(search).get('atlas_clean') === '1';
}
