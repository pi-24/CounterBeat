/**
 * FpsCamera.js
 *
 * A first-person camera driven the way a tactical shooter drives it: pointer
 * lock, raw mouse counts turned into degrees of yaw and pitch through the
 * player's sensitivity setting, a recoil kick that recovers on its own, and a
 * little view bob while strafing.
 *
 * The engine's own camera controls are switched off so that the only thing
 * moving the view is this class.
 */
import { Scene, Vector3, Axis, Camera, FreeCamera } from '../engine.js';
import { WORLD } from '../rules/config.js';

const PITCH_LIMIT = (80 * Math.PI) / 180;
const RECOIL_RECOVERY = 11;      // per second
const BOB_FREQUENCY = 9.5;        // cycles per second at full speed
const BOB_AMPLITUDE = 0.018;      // metres

export class FpsCamera {
    /**
     * @param {Scene} scene
     * @param {HTMLCanvasElement} canvas
     * @param {import('../Settings.js').Settings} settings
     */
    constructor(scene, canvas, settings) {
        this.scene = scene;
        this.canvas = canvas;
        this.settings = settings;

        this.camera = new FreeCamera('fps', new Vector3(0, WORLD.eyeHeight, 0), scene);
        this.camera.inputs.clear();
        this.camera.minZ = 0.05;
        this.camera.maxZ = 220;
        this.camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
        this.camera.inertia = 0;
        scene.activeCamera = this.camera;

        this.yaw = 0;
        this.pitch = 0;
        this.recoilPitch = 0;
        this.bobPhase = 0;
        this.bobOffset = 0;
        this.lookEnabled = false;

        /** @type {Set<(locked:boolean) => void>} */
        this.lockListeners = new Set();

        this.handleMouseMove = (event) => this.onMouseMove(event);
        this.handleLockChange = () => {
            const locked = this.locked;
            for (const listener of this.lockListeners) {
                listener(locked);
            }
        };

        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('pointerlockchange', this.handleLockChange);

        this.applyFov();
        settings.onChange(() => this.applyFov());
    }

    applyFov() {
        this.camera.fov = (this.settings.get('fov') * Math.PI) / 180;
    }

    /** @returns {boolean} whether the mouse is captured by the canvas. */
    get locked() {
        return document.pointerLockElement === this.canvas;
    }

    /** Captures the mouse.  Must be called from a user gesture. */
    async lock() {
        if (this.locked) {
            return;
        }
        try {
            // Raw input, as a shooter would: no OS pointer acceleration.
            const result = this.canvas.requestPointerLock({ unadjustedMovement: true });
            if (result && typeof result.catch === 'function') {
                await result.catch(() => this.canvas.requestPointerLock());
            }
        } catch (error) {
            this.canvas.requestPointerLock();
        }
    }

    unlock() {
        if (this.locked) {
            document.exitPointerLock();
        }
    }

    /** @param {(locked:boolean) => void} listener */
    onLockChange(listener) {
        this.lockListeners.add(listener);
        return () => this.lockListeners.delete(listener);
    }

    /** @param {MouseEvent} event */
    onMouseMove(event) {
        if (!this.locked || !this.lookEnabled) {
            return;
        }
        const degrees = this.settings.degreesPerCount;
        const toRadians = Math.PI / 180;
        this.yaw += event.movementX * degrees * toRadians;
        this.pitch += event.movementY * degrees * toRadians;
        this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    }

    /** Points the view straight down the arena. */
    resetLook() {
        this.yaw = 0;
        this.pitch = 0;
        this.recoilPitch = 0;
    }

    /** @param {number} degrees an upward kick, applied instantly. */
    kick(degrees) {
        this.recoilPitch -= (degrees * Math.PI) / 180;
    }

    /**
     * @param {number} worldX the player's lateral position in metres.
     * @param {number} dt seconds since the last frame.
     * @param {number} speedFraction 0..1, how fast the player is moving.
     */
    update(worldX, dt, speedFraction) {
        // Recoil recovers exponentially towards zero.
        this.recoilPitch += (0 - this.recoilPitch) * Math.min(1, RECOIL_RECOVERY * dt);

        if (this.settings.get('viewBob') && speedFraction > 0.05) {
            this.bobPhase += dt * BOB_FREQUENCY * speedFraction * Math.PI * 2;
            this.bobOffset = Math.sin(this.bobPhase) * BOB_AMPLITUDE * speedFraction;
        } else {
            this.bobOffset += (0 - this.bobOffset) * Math.min(1, 10 * dt);
        }

        this.camera.position.set(worldX, WORLD.eyeHeight + this.bobOffset, 0);
        this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, 0);
    }

    /** @returns {Vector3} the eye position. */
    get position() {
        return this.camera.position;
    }

    /** @returns {Vector3} unit vector the camera is looking along. */
    get forward() {
        return this.camera.getDirection(Axis.Z);
    }

    /** @returns {Vector3} */
    get right() {
        return this.camera.getDirection(Axis.X);
    }

    /** @returns {Vector3} */
    get up() {
        return this.camera.getDirection(Axis.Y);
    }

    dispose() {
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('pointerlockchange', this.handleLockChange);
        this.camera.dispose();
    }
}
