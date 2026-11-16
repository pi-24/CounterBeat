/**
 * FeelController.js - subscribes to the FeedbackBus and drives the feel stack:
 * arena pulse, camera kick, perfect-stop flash, cosmetic hit-stop.  Gameplay
 * only emits events: 'beat', 'hit' {perfect, headshot}, 'shatter' {point, headshot, perfect}, 'perfectStop'.
 * Hit-stop only freezes cosmetic updates (see `frozen`); input and judging
 * timing never read it.
 */
import { effectPolicy, HIT_STOP_MS } from './reducedEffects.js';
import { FlashLimiter } from './flashLimiter.js';

export class FeelController {
    /**
     * @param {import('../providers/FeedbackBus.js').FeedbackBus} bus
     * @param {{get:Function}} settings
     * @param {{arena?:{pulse:Function}, camera?:{kick:Function}, hud?:{flashPerfect:Function, flashBeat?:Function, showHitmarker?:Function}}} targets
     * @param {() => number} [clock] seconds
     */
    constructor(bus, settings, targets, clock = () => performance.now() / 1000) {
        this.settings = settings;
        this.targets = targets;
        this.clock = clock;
        this.limiter = new FlashLimiter();
        this.hitStopUntil = 0;
        this.offs = [
            bus.on('beat', (e) => this.onBeat(e)),
            bus.on('hit', (e) => this.onHit(e)),
            bus.on('shatter', (e) => this.onShatter(e)),
            bus.on('perfectStop', () => this.onPerfectStop()),
        ];
    }

    get policy() { return effectPolicy(this.settings); }

    /** True while cosmetic updates should hold still. */
    get frozen() { return this.clock() < this.hitStopUntil; }

    /** Flashes are only rate-limited under Reduced Effects, so normal play never drops hit confirmation. */
    canFlash() {
        return this.policy.limitFlashes ? this.limiter.tryFlash(this.clock()) : true;
    }

    onBeat({ strength = 1 } = {}) {
        if (this.policy.pulse) this.targets.arena?.pulse(0.35 * strength);
        if (this.canFlash()) this.targets.hud?.flashBeat?.();
    }

    onHit({ perfect = false, headshot = false } = {}) {
        const policy = this.policy;
        if (this.canFlash()) this.targets.hud?.showHitmarker?.(headshot);
        if (policy.cameraKick && typeof this.targets.camera?.kick === 'function') this.targets.camera.kick(perfect ? 0.45 : 0.25);
        if (policy.hitStop) this.hitStopUntil = this.clock() + (headshot ? HIT_STOP_MS : HIT_STOP_MS * 0.75) / 1000;
    }

    /** Shatter is hit feedback, not an effect to hide: it stays on under Reduced Effects. */
    onShatter({ point = null, headshot = false, perfect = false } = {}) {
        this.targets.field?.shatter?.(point, { headshot, perfect });
    }

    onPerfectStop() {
        if (this.canFlash()) this.targets.hud?.flashPerfect();
    }

    dispose() { for (const off of this.offs) off(); this.offs = []; }
}
