/**
 * config.js
 *
 * Every tuning number the game uses, in one file.  Nothing here depends on
 * the 3D engine, which keeps the rules of the game readable on their own and
 * makes the judging logic straightforward to reason about.
 */

/**
 * The track the player strafes along is measured in abstract "track units"
 * (0 .. 1024) so the movement model, the chart generator and the headless
 * simulator can share one coordinate system.  WORLD converts to metres.
 */
export const LAYOUT = Object.freeze({
    trackLeft: 96,
    trackRight: 928,
    laneInset: 0.8,     // fraction of a lane slot that counts as "inside"
});

/** Metres per track unit, and where things sit in the arena. */
export const WORLD = Object.freeze({
    metresPerUnit: 0.012,           // 832 track units ≈ 10 m across
    eyeHeight: 1.62,
    wallZ: 4.4,                     // the pillar wall with the windows
    wallHeight: 2.9,
    pillarDepth: 0.45,
    targetZ: 12.5,                  // bots stand here, behind the windows
    backstopZ: 15,
    botHeight: 2.0,
    botHeadFraction: 0.78,          // above this fraction of height = head
    arenaHalfWidth: 14,
    arenaDepth: 26,
});

/**
 * Velocity thresholds in track units per second.  Accuracy in a tactical
 * shooter collapses as you move, so the game grades the shot on how close to
 * a dead stop the player was at the moment they fired.
 */
export const SPEED_GRADE = Object.freeze({
    pinPoint: 20,
    tight: 65,
    loose: 140,
});

/**
 * Hit-scan spread.  The cone the shot can land in, in degrees, grows with the
 * player's speed as a fraction of the level's top speed - the same idea as
 * running inaccuracy.  Standing still is nearly a laser.
 */
export const SPREAD = Object.freeze({
    baseDegrees: 0.12,
    movingDegrees: 7.5,
    exponent: 1.2,
});

/** Points awarded before the combo and counter-strafe multipliers. */
export const BASE_POINTS = Object.freeze({
    perfect: 100,
    good: 60,
    ok: 30,
    miss: 0,
});

/** Multiplier applied when the stop was produced by a counter-strafe. */
export const COUNTER_STRAFE_BONUS = 1.5;

/** Multiplier applied when the shot lands on the bot's head. */
export const HEADSHOT_BONUS = 1.25;

/** Combo reaches its ceiling at this many consecutive hits. */
export const COMBO_CEILING = 50;

/** The maximum combo multiplier at the ceiling. */
export const COMBO_MAX_MULTIPLIER = 2;

/** Focus (the fail bar) changes by these amounts per judgement. */
export const FOCUS_DELTA = Object.freeze({
    perfect: 3,
    good: 2,
    ok: 0,
    miss: -8,
    wildShot: -3,
});

export const FOCUS_MAX = 100;

/**
 * A counter-strafe only counts if the opposing key was pressed within this
 * many milliseconds of the shot.  Long enough to be generous, short enough
 * that simply releasing the key never qualifies.
 */
export const COUNTER_STRAFE_MEMORY_MS = 320;

/** How long the approach ring is visible before its note lands, in beats. */
export const APPROACH_BEATS = 2;

/** Grade names used throughout the game and the score records. */
export const GRADE = Object.freeze({
    PERFECT: 'perfect',
    GOOD: 'good',
    OK: 'ok',
    MISS: 'miss',
});

/** Human-readable labels for the judgement popup. */
export const GRADE_LABEL = Object.freeze({
    perfect: 'PERFECT',
    good: 'GOOD',
    ok: 'LOOSE',
    miss: 'MISS',
});

/** Mouse look: Counter-Strike's m_yaw, degrees of turn per count at sens 1. */
export const YAW_PER_COUNT = 0.022;

/** Valorant sensitivity is CS sensitivity divided by this. */
export const VALORANT_SENS_RATIO = 3.18;

/** Default player settings; persisted by Settings.js. */
export const DEFAULT_SETTINGS = Object.freeze({
    sensitivity: 1.6,       // CS-style
    dpi: 800,
    fov: 103,               // horizontal, Valorant's fixed value
    crosshairColour: '#7effba',
    crosshairLength: 7,
    crosshairGap: 4,
    crosshairThickness: 2,
    crosshairDot: false,
    viewBob: true,
});
