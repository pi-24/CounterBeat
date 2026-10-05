/**
 * Settings.js
 *
 * The player's mouse, field-of-view and crosshair settings, persisted as JSON
 * in local storage under `counterbeat:settings`.  Sensitivity is expressed
 * the way Counter-Strike expresses it, with the Valorant equivalent and the
 * physical cm/360 derived from it, because that is the number the target
 * audience already knows.
 */
import { store } from '../core/Storage.js';
import { DEFAULT_SETTINGS, VALORANT_SENS_RATIO, YAW_PER_COUNT } from './config.js';

const KEY = 'settings';

export class Settings {
    constructor(storage = store) {
        this.storage = storage;
        this.values = { ...DEFAULT_SETTINGS, ...this.storage.read(KEY, {}) };
        /** @type {Set<(values:object) => void>} */
        this.listeners = new Set();
    }

    /** @template T @param {string} key @returns {T} */
    get(key) {
        return this.values[key];
    }

    /**
     * @param {Partial<typeof DEFAULT_SETTINGS>} changes
     */
    update(changes) {
        this.values = { ...this.values, ...Settings.sanitise(changes) };
        this.storage.write(KEY, this.values);
        for (const listener of this.listeners) {
            listener(this.values);
        }
    }

    reset() {
        this.values = { ...DEFAULT_SETTINGS };
        this.storage.write(KEY, this.values);
        for (const listener of this.listeners) {
            listener(this.values);
        }
    }

    /** @param {(values:object) => void} listener */
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** @returns {number} degrees of yaw per mouse count. */
    get degreesPerCount() {
        return this.values.sensitivity * YAW_PER_COUNT;
    }

    /** @returns {number} the equivalent Valorant sensitivity. */
    get valorantSensitivity() {
        return this.values.sensitivity / VALORANT_SENS_RATIO;
    }

    /** @returns {number} centimetres of mouse travel for a full turn. */
    get cmPer360() {
        const countsPerTurn = 360 / this.degreesPerCount;
        const inches = countsPerTurn / this.values.dpi;
        return inches * 2.54;
    }

    /**
     * Clamps every value to a sensible range so a corrupt record cannot
     * produce an unplayable game.
     * @param {object} changes
     */
    static sanitise(changes) {
        const out = {};
        if ('sensitivity' in changes) {
            out.sensitivity = Settings.clamp(Number(changes.sensitivity), 0.1, 10);
        }
        if ('dpi' in changes) {
            out.dpi = Settings.clamp(Math.round(Number(changes.dpi)), 100, 32000);
        }
        if ('fov' in changes) {
            out.fov = Settings.clamp(Math.round(Number(changes.fov)), 60, 130);
        }
        if ('crosshairColour' in changes && /^#[0-9a-f]{6}$/i.test(String(changes.crosshairColour))) {
            out.crosshairColour = String(changes.crosshairColour);
        }
        if ('crosshairLength' in changes) {
            out.crosshairLength = Settings.clamp(Math.round(Number(changes.crosshairLength)), 0, 20);
        }
        if ('crosshairGap' in changes) {
            out.crosshairGap = Settings.clamp(Math.round(Number(changes.crosshairGap)), 0, 20);
        }
        if ('crosshairThickness' in changes) {
            out.crosshairThickness = Settings.clamp(Math.round(Number(changes.crosshairThickness)), 1, 6);
        }
        if ('crosshairDot' in changes) {
            out.crosshairDot = Boolean(changes.crosshairDot);
        }
        if ('viewBob' in changes) {
            out.viewBob = Boolean(changes.viewBob);
        }
        return out;
    }

    /** @param {number} value @param {number} min @param {number} max */
    static clamp(value, min, max) {
        if (!Number.isFinite(value)) {
            return min;
        }
        return Math.max(min, Math.min(max, value));
    }
}

export const settings = new Settings();
