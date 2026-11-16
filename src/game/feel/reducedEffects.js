/**
 * reducedEffects.js - which feel effects are active for a settings object.
 * Reduced Effects turns off the pulse, camera kick and hit-stop; flashes stay
 * but are always capped (see flashLimiter.js) at no more than 3 per second.
 * Reduced Flash is stronger: no flashes at all (the hitmarker becomes a static, non-flashing one).
 */
export const HIT_STOP_MS = 40; // GDD: 30-50 ms, cosmetic only

/** @param {{get:(k:string)=>any}|{reducedEffects?:boolean}} settings */
export function effectPolicy(settings) {
    const read = (key) => Boolean(typeof settings.get === 'function' ? settings.get(key) : settings[key]);
    const reduced = read('reducedEffects');
    const reducedFlash = read('reducedFlash');
    return Object.freeze({
        pulse: !reduced,
        cameraKick: !reduced,
        hitStop: !reduced,
        flash: !reducedFlash,                  // reduced flash: no perfect-stop flash or beat-ring flash at all
        softHitmarker: reducedFlash,           // ...the hitmarker stays, as a small non-animated confirmation
        limitFlashes: reduced || reducedFlash, // the 3/s cap applies when Reduced Effects is on
        flashesPerSecond: 3,
    });
}
