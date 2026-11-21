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
import { Scene, Vector3, Color3, Color4, Ray, Mesh, StandardMaterial, Texture, SpriteManager, Sprite, ParticleSystem, MeshBuilder } from '../engine.js';
import { APPROACH_BEATS, WORLD } from '../rules/config.js';
import { themeProvider, assets } from '../providers/index.js';
import { Arena } from './Arena.js';
import { HITBOX, scaleHitbox, zoneAt } from '../rules/aim.js';
import { rangeLook } from './rangePalette.js';

const FRAMES = {
    idle: [0, 3],
    hit: [4, 5],
    death: [6, 9],
};
/** Enough spark systems for the fastest charts' overlapping bursts. */
const SPARK_POOL_SIZE = 6;
/** Particles per system: a headshot burst, the largest. */
const SPARK_CAPACITY = 26;
const color4 = (rgb, a = 1) => new Color4(rgb[0], rgb[1], rgb[2], a);

export class TargetField {
    /**
     * @param {Scene} scene
     * @param {import('../BeatMap.js').Lanes} lanes
     * @param {import('./FpsCamera.js').FpsCamera} camera
     * @param {number[]} accent level accent colour as [r, g, b]
     * @param {string} [skinId] id from data/targets.json (default skin when omitted)
     * @param {number} [hitboxScale]
     * @param {boolean} [light] pale (bone) room: rings and sparks switch to flat ink marks (rangePalette.js)
     */
    constructor(scene, lanes, camera, accent, skinId, hitboxScale = 1, light = false) {
        this.look = rangeLook(light, accent);
        this.look.sparks.normalColour = color4(this.look.sparks.normal);
        this.look.sparks.brightColour = color4(this.look.sparks.bright);
        this.hitbox = scaleHitbox(HITBOX, hitboxScale);
        const SHEET = themeProvider.target(skinId);
        this.sheet = SHEET;
        this.scene = scene;
        this.lanes = lanes;
        this.camera = camera;

        this.manager = new SpriteManager('bots', SHEET.sheet, 32,
            { width: SHEET.cellWidth, height: SHEET.cellHeight }, scene);
        this.manager.isPickable = true;

        this.ringIdle = new StandardMaterial('ring-idle', scene);
        this.ringIdle.emissiveColor = new Color3(...this.look.ring.idle);
        this.ringIdle.diffuseColor = Color3.Black();
        this.ringIdle.specularColor = Color3.Black();
        this.ringIdle.disableLighting = true;

        this.ringClose = new StandardMaterial('ring-close', scene);
        this.ringClose.emissiveColor = new Color3(...this.look.ring.close);
        this.ringClose.diffuseColor = Color3.Black();
        this.ringClose.specularColor = Color3.Black();
        this.ringClose.disableLighting = true;

        this.sparkTexture = new Texture(assets.spark(), scene);

        // One torus for every approach ring: each bot gets a clone that shares
        // its geometry, so spawning a bot never builds or uploads a mesh.
        this.ringTemplate = MeshBuilder.CreateTorus('ring-template', {
            diameter: 1, thickness: 0.07, tessellation: 48,
        }, scene);
        // A torus lies flat by default; tipping it up makes it face the
        // player, who is always looking down the corridor at it.
        this.ringTemplate.rotation.x = Math.PI / 2;
        this.ringTemplate.material = this.ringIdle;
        this.ringTemplate.isPickable = false;
        this.ringTemplate.setEnabled(false);

        /** Hit sparks, reused round-robin instead of built and thrown away per hit. */
        this.sparkPool = [];
        this.sparkNext = 0;

        /** @type {{note: object, sprite: Sprite, ring: Mesh, resolved: boolean}[]} */
        this.entries = [];
    }

    /**
     * Compiles the ring and spark shaders before the run starts, so the
     * first bot and the first hit do not stall a frame doing it.
     */
    async prepare() {
        try {
            await Promise.all([
                this.ringIdle.forceCompilationAsync(this.ringTemplate),
                this.ringClose.forceCompilationAsync(this.ringTemplate),
            ]);
        } catch (error) {
            console.warn('TargetField: could not precompile ring materials', error);
        }
        // A spark burst far below the floor: invisible, but it builds the
        // particle shader and buffers now rather than on the first hit.
        this.burst(new Vector3(0, -50, 0), 1, false);
    }

    /**
     * @param {object} note
     * @returns {object} the entry created.
     */
    spawn(note) {
        const x = Arena.toWorldX(this.lanes.centre(note.lane));
        const height = WORLD.botHeight;
        const width = height * (this.sheet.cellWidth / this.sheet.cellHeight);

        // Notes that share a lane queue up behind one another, so a double
        // reads as two bots in a line rather than one bot drawn twice.
        const queued = this.entries.filter((entry) => !entry.resolved && entry.note.lane === note.lane).length;
        const z = WORLD.targetZ + queued * 1.0;

        const sprite = new Sprite('bot', this.manager);
        sprite.width = width;
        sprite.height = height;
        sprite.position.set(x, height / 2, z);
        sprite.isPickable = true;
        sprite.playAnimation(FRAMES.idle[0], FRAMES.idle[1], true, 170);
        // Each bot breathes out of phase with its neighbours.
        sprite.cellIndex = note.index % 4;

        const ring = this.ringTemplate.clone('ring');
        ring.position.set(x, height * 0.52, z - 0.3);
        ring.material = this.ringIdle;
        ring.isPickable = false;
        ring.setEnabled(true);

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
            const material = Math.abs(remaining) <= goodWindow ? this.ringClose : this.ringIdle;
            if (entry.ring.material !== material) {
                entry.ring.material = material;
            }
        }
    }

    /**
     * Fires a ray and reports what it reached.
     * @param {Ray} ray
     * @returns {{entry: object|null, zone: 'head'|'body'|'none', blocked: boolean,
     *            point: Vector3|null, distance: number}}
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
     * @param {Sprite} sprite
     * @param {Vector3} point
     */
    zoneFor(sprite, point) {
        const delta = point.subtract(sprite.position);
        const dx = Vector3.Dot(delta, this.camera.right);
        const height = sprite.height;
        const fromBottom = point.y - (sprite.position.y - height / 2);

        return zoneAt(dx, fromBottom, height, this.hitbox);
    }

    /**
     * Plays the hit or miss reaction and retires the bot.
     * @param {object} entry
     * @param {boolean} hit
     * @param {Vector3|null} point where the shot landed, for sparks.
     * @param {boolean} [headshot]
     */
    resolve(entry, hit, point, headshot = false) {
        if (entry.resolved) {
            return;
        }
        entry.resolved = true;
        entry.ring.dispose();
        // A bot that has been judged must stop catching rays, otherwise its
        // death animation shields the bot queued behind it in the same lane.
        entry.sprite.isPickable = false;

        if (hit) {
            // The shatter itself is a feel effect: PlayScreen emits 'shatter' on the FeedbackBus.
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
     * Target shatter: a burst of shards where the shot landed, bigger on a
     * headshot or a perfect stop.  Purely cosmetic.
     * @param {Vector3|null} point
     * @param {{headshot?:boolean, perfect?:boolean}} [opts]
     */
    shatter(point, { headshot = false, perfect = false } = {}) {
        if (!point) {
            return;
        }
        this.burst(point, (headshot ? 26 : 14) + (perfect ? 6 : 0), headshot || perfect);
    }

    /**
     * A hit that does not count: the bot flashes and goes back to idling.
     * @param {object} entry
     */
    flinch(entry) {
        if (!entry || entry.resolved) {
            return;
        }
        entry.sprite.playAnimation(FRAMES.hit[0], FRAMES.hit[1], false, 55, () => {
            if (!entry.resolved) {
                entry.sprite.playAnimation(FRAMES.idle[0], FRAMES.idle[1], true, 170);
            }
        });
    }

    /**
     * A one-shot spark burst.
     * @param {Vector3} point
     * @param {number} count
     * @param {boolean} bright
     */
    burst(point, count, bright) {
        const particles = this.nextSparks();
        particles.stop();
        particles.reset();
        particles.emitter.copyFrom(point);
        particles.color1.copyFrom(bright ? this.look.sparks.brightColour : this.look.sparks.normalColour);
        particles.maxSize = bright ? 0.22 : 0.15;
        particles.manualEmitCount = Math.min(count, SPARK_CAPACITY);
        particles.start();
    }

    /** @returns {ParticleSystem} the next system in the pool, built on first use. */
    nextSparks() {
        if (this.sparkPool.length < SPARK_POOL_SIZE) {
            const particles = new ParticleSystem('spark', SPARK_CAPACITY, this.scene);
            particles.particleTexture = this.sparkTexture;
            particles.emitter = new Vector3(0, 0, 0);
            particles.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
            particles.maxEmitBox = new Vector3(0.05, 0.05, 0.05);
            particles.color1 = this.look.sparks.normalColour.clone();
            particles.color2 = color4(this.look.sparks.mid);
            particles.colorDead = color4(this.look.sparks.dead, 0);
            particles.minSize = 0.06;
            particles.maxSize = 0.15;
            particles.minLifeTime = 0.15;
            particles.maxLifeTime = 0.4;
            particles.emitRate = 0;
            particles.blendMode = this.look.sparks.additive ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
            particles.direction1 = new Vector3(-1, -0.5, -1);
            particles.direction2 = new Vector3(1, 1.4, 1);
            particles.minEmitPower = 1.5;
            particles.maxEmitPower = 4.5;
            particles.gravity = new Vector3(0, -9, 0);
            particles.targetStopDuration = 0.45;
            particles.disposeOnStop = false;
            this.sparkPool.push(particles);
            return particles;
        }
        const particles = this.sparkPool[this.sparkNext];
        this.sparkNext = (this.sparkNext + 1) % this.sparkPool.length;
        return particles;
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
        for (const particles of this.sparkPool) {
            particles.dispose(false);
        }
        this.sparkPool = [];
        this.ringTemplate.dispose();
        this.manager.dispose();
        this.ringIdle.dispose();
        this.ringClose.dispose();
        this.sparkTexture.dispose();
    }
}
