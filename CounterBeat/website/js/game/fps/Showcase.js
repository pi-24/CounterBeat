/**
 * Showcase.js
 *
 * The arena behind the menu and results overlays: a level's room with the
 * camera drifting gently, so the player is looking at the place they are
 * about to play rather than at a flat backdrop.
 */
import { BeatMap } from '../BeatMap.js';
import { Arena } from './Arena.js';

export class Showcase {
    /**
     * @param {BABYLON.Scene} scene
     * @param {import('./FpsCamera.js').FpsCamera} camera
     * @param {object} level
     */
    constructor(scene, camera, level) {
        this.camera = camera;
        this.level = level;
        this.lanes = new BeatMap(level).lanes;
        this.arena = new Arena(scene, level, this.lanes);
        this.time = 0;
        this.lane = 0;
        this.laneTimer = 0;

        camera.lookEnabled = false;
        camera.resetLook();
    }

    /** @param {number} dt */
    update(dt) {
        this.time += dt;
        this.laneTimer += dt;
        if (this.laneTimer > 60 / this.level.bpm * 2) {
            this.laneTimer = 0;
            this.lane = (this.lane + 1) % this.lanes.count;
            this.arena.setActiveLane(this.lane);
        }
        const sway = Math.sin(this.time * 0.35) * 1.4;
        this.camera.yaw = Math.sin(this.time * 0.25) * 0.08;
        this.camera.pitch = 0.03 + Math.sin(this.time * 0.4) * 0.015;
        this.camera.update(sway, dt, 0);
    }

    dispose() {
        this.arena.dispose();
    }
}
