/**
 * TargetField.js
 *
 * The bots.  Each upcoming note gets a billboard sprite standing on its
 * lane's pad, animated from the sprite sheet (idle, hit, death), with an
 * approach ring that closes on it in time with the music.
 *
 * This class also answers the only question the shooting code needs to ask:
 * "does this ray hit a bot, and where?"  The sprite's picking quad is wider
 * than the bot drawn on it, so a hit is confirmed against a body box and a
 * head circle rather than the quad - a shot through the gap under the arm is
 * a miss, as it should be.
 */
import { APPROACH_BEATS, WORLD } from '../config.js';
import { Arena } from './Arena.js';

const SHEET = { url: 'images/bot-sheet.png', cellWidth: 96, cellHeight: 128 };
const FRAMES = {
    idle: [0, 3],
    hit: [4, 5],
    death: [6, 9],
};
const HITBOX = {
    bodyHalfWidth: 0.46,
    bodyBottom: 0.04,
    bodyTop: 0.76,       // fraction of height
    headCentre: 0.84,    // fraction of height
    headRadius: 0.22,
};

export class TargetField {
    /**
     * @param {BABYLON.Scene} scene
     * @param {import('../BeatMap.js').Lanes} lanes
     * @param {import('./FpsCamera.js').FpsCamera} camera
     * @param {number[]} accent level accent colour as [r, g, b]
     */
    constructor(scene, lanes, camera, accent) {
        this.scene = scene;
        this.lanes = lanes;
        this.camera = camera;

        this.manager = new BABYLON.SpriteManager('bots', SHEET.url, 32,
            { width: SHEET.cellWidth, height: SHEET.cellHeight }, scene);
        this.manager.isPickable = true;

        const [r, g, b] = accent;
        this.ringIdle = new BABYLON.StandardMaterial('ring-idle', scene);
        this.ringIdle.emissiveColor = new BABYLON.Color3(r, g, b);
        this.ringIdle.diffuseColor = BABYLON.Color3.Black();
        this.ringIdle.specularColor = BABYLON.Color3.Black();
        this.ringIdle.disableLighting = true;

        this.ringClose = new BABYLON.StandardMaterial('ring-close', scene);
        this.ringClose.emissiveColor = new BABYLON.Color3(0.49, 1, 0.73);
        this.ringClose.diffuseColor = BABYLON.Color3.Black();
        this.ringClose.specularColor = BABYLON.Color3.Black();
        this.ringClose.disableLighting = true;

        this.sparkTexture = new BABYLON.Texture('images/spark.png', scene);

        /** @type {{note: object, sprite: BABYLON.Sprite, ring: BABYLON.Mesh, resolved: boolean}[]} */
        this.entries = [];
    }

    /**
     * @param {object} note
     * @returns {object} the entry created.
     */
    spawn(note) {
        const x = Arena.toWorldX(this.lanes.centre(note.lane));
        const height = WORLD.botHeight;
        const width = height * (SHEET.cellWidth / SHEET.cellHeight);

        // Notes that share a lane queue up behind one another, so a double
        // reads as two bots in a line rather than one bot drawn twice.
        const queued = this.entries.filter((entry) => !entry.resolved && entry.note.lane === note.lane).length;
        const z = WORLD.targetZ + queued * 0.8;

        const sprite = new BABYLON.Sprite('bot', this.manager);
        sprite.width = width;
        sprite.height = height;
        sprite.position.set(x, height / 2, z);
        sprite.isPickable = true;
        sprite.playAnimation(FRAMES.idle[0], FRAMES.idle[1], true, 170);
        // Each bot breathes out of phase with its neighbours.
        sprite.cellIndex = note.index % 4;

        const ring = BABYLON.MeshBuilder.CreateTorus('ring', {
            diameter: 1, thickness: 0.07, tessellation: 48,
        }, this.scene);
        ring.position.set(x, height * 0.52, z - 0.3);
        // A torus lies flat by default; tipping it up makes it face the
        // player, who is always looking down the corridor at it.
        ring.rotation.x = Math.PI / 2;
        ring.material = this.ringIdle;
        ring.isPickable = false;

        const entry = { note, sprite, ring, resolved: false };
        this.entries.push(entry);
        return entry;
    }

    /**
     * Scales the approach rings.
     * @param {number} songTime
     * @param {number} secondsPerBeat
     * @param {number} goodWindow seconds; inside it the ring turns green.
     */
    update(songTime, secondsPerBeat, goodWindow) {
        const lead = APPROACH_BEATS * secondsPerBeat;
        for (const entry of this.entries) {
            if (entry.resolved) {
                continue;
            }
            const remaining = entry.note.time - songTime;
            const progress = Math.max(0, Math.min(1, 1 - remaining / lead));
            const diameter = 1.25 - 0.83 * progress;
            entry.ring.scaling.set(diameter, diameter, diameter);
            entry.ring.material = Math.abs(remaining) <= goodWindow ? this.ringClose : this.ringIdle;
        }
    }

    /**
     * Fires a ray and reports what it reached.
     * @param {BABYLON.Ray} ray
     * @returns {{entry: object|null, zone: 'head'|'body'|'none', blocked: boolean,
     *            point: BABYLON.Vector3|null, distance: number}}
     */
    pick(ray) {
        const solid = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable);
        const solidDistance = solid && solid.hit ? solid.distance : Number.POSITIVE_INFINITY;

        const spritePick = this.scene.pickSpriteWithRay(ray, (sprite) => sprite.isPickable, false, this.camera.camera);

        if (spritePick && spritePick.hit && spritePick.distance < solidDistance) {
            const struck = this.entries.find((candidate) => candidate.sprite === spritePick.pickedSprite && !candidate.resolved);
            // Bots queued in the same lane overlap on screen; the shot always
            // counts for the earliest note so a double is judged in order.
            const entry = struck
                ? this.entries
                    .filter((candidate) => !candidate.resolved && candidate.note.lane === struck.note.lane)
                    .sort((a, b) => a.note.time - b.note.time)[0]
                : null;
            if (entry) {
                const zone = this.zoneFor(struck.sprite, spritePick.pickedPoint);
                if (zone !== 'none') {
                    return {
                        entry, zone, blocked: false,
                        point: spritePick.pickedPoint, distance: spritePick.distance,
                    };
                }
                // Hit the transparent part of the quad: carry on to the wall.
            }
        }

        const point = solid && solid.hit ? solid.pickedPoint : null;
        const blocked = Boolean(point) && point.z < WORLD.targetZ - 1;
        return { entry: null, zone: 'none', blocked, point, distance: solidDistance };
    }

    /**
     * Head or body, measured in the bot's own billboard plane.
     * @param {BABYLON.Sprite} sprite
     * @param {BABYLON.Vector3} point
     */
    zoneFor(sprite, point) {
        const delta = point.subtract(sprite.position);
        const dx = BABYLON.Vector3.Dot(delta, this.camera.right);
        const height = sprite.height;
        const fromBottom = point.y - (sprite.position.y - height / 2);

        const headY = HITBOX.headCentre * height;
        const headDistance = Math.hypot(dx, fromBottom - headY);
        if (headDistance <= HITBOX.headRadius) {
            return 'head';
        }
        if (Math.abs(dx) <= HITBOX.bodyHalfWidth
            && fromBottom >= HITBOX.bodyBottom
            && fromBottom <= HITBOX.bodyTop * height) {
            return 'body';
        }
        return 'none';
    }

    /**
     * Plays the hit or miss reaction and retires the bot.
     * @param {object} entry
     * @param {boolean} hit
     * @param {BABYLON.Vector3|null} point where the shot landed, for sparks.
     * @param {boolean} [headshot]
     */
    resolve(entry, hit, point, headshot = false) {
        if (entry.resolved) {
            return;
        }
        entry.resolved = true;
        entry.ring.dispose();

        if (hit) {
            if (point) {
                this.burst(point, headshot ? 26 : 14, headshot);
            }
            entry.sprite.playAnimation(FRAMES.hit[0], FRAMES.hit[1], false, 55, () => {
                entry.sprite.playAnimation(FRAMES.death[0], FRAMES.death[1], false, 70, () => {
                    this.remove(entry);
                });
            });
        } else {
            // Missed: the bot simply stands down and fades.
            entry.sprite.playAnimation(FRAMES.death[0], FRAMES.death[1], false, 90, () => {
                this.remove(entry);
            });
        }
    }

    /**
     * A one-shot spark burst.
     * @param {BABYLON.Vector3} point
     * @param {number} count
     * @param {boolean} bright
     */
    burst(point, count, bright) {
        const particles = new BABYLON.ParticleSystem('spark', count, this.scene);
        particles.particleTexture = this.sparkTexture;
        particles.emitter = point.clone();
        particles.minEmitBox = new BABYLON.Vector3(-0.05, -0.05, -0.05);
        particles.maxEmitBox = new BABYLON.Vector3(0.05, 0.05, 0.05);
        particles.color1 = bright ? new BABYLON.Color4(1, 0.95, 0.7, 1) : new BABYLON.Color4(1, 0.7, 0.35, 1);
        particles.color2 = new BABYLON.Color4(1, 0.5, 0.2, 1);
        particles.colorDead = new BABYLON.Color4(0.3, 0.1, 0, 0);
        particles.minSize = 0.06;
        particles.maxSize = bright ? 0.22 : 0.15;
        particles.minLifeTime = 0.15;
        particles.maxLifeTime = 0.4;
        particles.emitRate = 0;
        particles.manualEmitCount = count;
        particles.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
        particles.direction1 = new BABYLON.Vector3(-1, -0.5, -1);
        particles.direction2 = new BABYLON.Vector3(1, 1.4, 1);
        particles.minEmitPower = 1.5;
        particles.maxEmitPower = 4.5;
        particles.gravity = new BABYLON.Vector3(0, -9, 0);
        particles.targetStopDuration = 0.45;
        particles.disposeOnStop = true;
        particles.start();
    }

    /** @param {object} entry */
    remove(entry) {
        entry.sprite.dispose();
        if (!entry.ring.isDisposed()) {
            entry.ring.dispose();
        }
        this.entries = this.entries.filter((candidate) => candidate !== entry);
    }

    /** @param {object} note @returns {object|undefined} */
    entryFor(note) {
        return this.entries.find((entry) => entry.note === note);
    }

    dispose() {
        for (const entry of [...this.entries]) {
            this.remove(entry);
        }
        this.manager.dispose();
        this.ringIdle.dispose();
        this.ringClose.dispose();
        this.sparkTexture.dispose();
    }
}
