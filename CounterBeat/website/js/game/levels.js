/**
 * levels.js
 *
 * The three levels.  Each one changes the arena, the tempo, the number of
 * windows in the wall, how quickly the player moves and how tight the timing
 * windows are, so finishing a level genuinely hands the player a harder
 * problem.
 *
 * `pattern` lists the note positions inside one bar, measured in beats, so a
 * value of 1.5 is the "and" of beat two.  `arena` is everything the 3D
 * builder needs to dress the level.
 */

export const LEVELS = Object.freeze([
    {
        id: 1,
        name: 'The Range',
        subtitle: 'Learn the tap',
        musicKey: 'music-level1',
        bpm: 90,
        bars: 24,
        firstNoteBar: 2,
        lanes: 3,
        trackScale: 1,
        laneInset: 0.60,
        pattern: [0, 2],
        timing: { perfect: 0.055, good: 0.110, ok: 0.170 },
        movement: { maxSpeed: 340, accel: 3000, counterDecel: 4600, friction: 820 },
        passAccuracy: 0.55,
        seed: 1101,
        arena: {
            floorTexture: 'images/textures/floor-range.png',
            wallTexture: 'images/textures/wall-range.png',
            sky: [0.72, 0.78, 0.86],
            fog: { colour: [0.72, 0.78, 0.86], density: 0.012 },
            accent: [1.0, 0.54, 0.16],
            ambient: 0.85,
            decor: 'crates',
        },
    },
    {
        id: 2,
        name: 'Neon Alley',
        subtitle: 'Off-beat pressure',
        musicKey: 'music-level2',
        bpm: 120,
        bars: 32,
        firstNoteBar: 3,
        lanes: 4,
        trackScale: 0.88,
        laneInset: 0.55,
        pattern: [0, 1.5, 2, 3.5],
        timing: { perfect: 0.045, good: 0.090, ok: 0.145 },
        movement: { maxSpeed: 500, accel: 4800, counterDecel: 7000, friction: 1190 },
        passAccuracy: 0.60,
        seed: 2202,
        arena: {
            floorTexture: 'images/textures/floor-neon.png',
            wallTexture: 'images/textures/wall-neon.png',
            sky: [0.05, 0.04, 0.12],
            fog: { colour: [0.05, 0.04, 0.12], density: 0.028 },
            accent: [0.42, 0.89, 1.0],
            ambient: 0.45,
            decor: 'neon',
        },
    },
    {
        id: 3,
        name: 'Server Vault',
        subtitle: 'Chain the stops',
        musicKey: 'music-level3',
        bpm: 150,
        bars: 40,
        firstNoteBar: 4,
        lanes: 5,
        trackScale: 0.70,
        laneInset: 0.50,
        pattern: [0, 1, 1.5, 2, 3, 3.5],
        timing: { perfect: 0.038, good: 0.075, ok: 0.120 },
        movement: { maxSpeed: 680, accel: 7000, counterDecel: 9500, friction: 1620 },
        passAccuracy: 0.65,
        seed: 3303,
        arena: {
            floorTexture: 'images/textures/floor-vault.png',
            wallTexture: 'images/textures/wall-vault.png',
            sky: [0.03, 0.08, 0.06],
            fog: { colour: [0.03, 0.08, 0.06], density: 0.040 },
            accent: [0.49, 1.0, 0.73],
            ambient: 0.40,
            decor: 'racks',
        },
    },
]);

/**
 * @param {number} id
 * @returns {object | undefined}
 */
export function getLevel(id) {
    return LEVELS.find((level) => level.id === Number(id));
}

/**
 * @param {number} id
 * @returns {object | undefined} the level after this one, if any.
 */
export function nextLevel(id) {
    return LEVELS.find((level) => level.id === Number(id) + 1);
}
