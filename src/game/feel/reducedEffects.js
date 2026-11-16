/**
 * reducedEffects.js - which feel effects are active for a settings object.
 * Reduced Effects turns off the pulse, camera kick and hit-stop; flashes stay
 * but are always capped (see flashLimiter.js) at no more than 3 per second.
 */
export const HIT_STOP_MS = 40; // GDD: 30-50 ms, cosmetic only

/** @param {{get:(k:string)=>any}|{reducedEffects?:boolean}} settings */
export function effectPolicy(settings) {
    const reduced = Boolean(typeof settings.get === 'function' ? settings.get('reducedEffects') : settings.reducedEffects);
    return Object.freeze({
        pulse: !reduced,
        cameraKick: !reduced,
        hitStop: !reduced,
        flash: true,
        limitFlashes: reduced, // the 3/s cap applies when Reduced Effects is on
        flashesPerSecond: 3,
    });
}
