/**
 * Arena.js
 *
 * Builds the 3D room for a level: a grid floor, a wall with one open window
 * per lane, the pads the bots stand on, the backstop behind them and the
 * level's set dressing.  Everything is plain boxes and planes with flat
 * materials - the clean, low-poly look of a browser aim trainer - and it is
 * all generated in code, so a level is dressed by changing a few numbers in
 * levels.js rather than by modelling anything.
 *
 * The one piece of geometry that matters to the rules is the window wall.
 * Each window lines up with a lane, so a shot taken from the wrong lane hits
 * the wall instead of the bot.  That is what makes "be standing in the lane"
 * a physical constraint rather than a rule the player has to be told about.
 */
import { LAYOUT, WORLD } from '../config.js';

const TRACK_CENTRE = (LAYOUT.trackLeft + LAYOUT.trackRight) / 2;

export class Arena {
    /**
     * @param {BABYLON.Scene} scene
     * @param {object} level
     * @param {import('../BeatMap.js').Lanes} lanes
     */
    constructor(scene, level, lanes) {
        this.scene = scene;
        this.level = level;
        this.lanes = lanes;
        this.arena = level.arena;

        /** @type {BABYLON.Mesh[]} meshes the hit-scan treats as solid. */
        this.solids = [];
        /** @type {BABYLON.Mesh[][]} window frame pieces per lane. */
        this.frames = [];
        this.disposables = [];

        this.buildMaterials();
        this.buildLighting();
        this.buildFloor();
        this.buildWindowWall();
        this.buildPads();
        this.buildBackstop();
        this.buildDecor();
    }

    /** @param {number} trackX @returns {number} metres */
    static toWorldX(trackX) {
        return (trackX - TRACK_CENTRE) * WORLD.metresPerUnit;
    }

    /** @param {number} trackUnits @returns {number} metres */
    static toWorldLength(trackUnits) {
        return trackUnits * WORLD.metresPerUnit;
    }

    // ------------------------------------------------------- materials ----

    buildMaterials() {
        const scene = this.scene;
        const [r, g, b] = this.arena.accent;
        const accent = new BABYLON.Color3(r, g, b);

        this.floorMaterial = new BABYLON.StandardMaterial('floor', scene);
        const floorTexture = new BABYLON.Texture(this.arena.floorTexture, scene);
        floorTexture.uScale = WORLD.arenaHalfWidth / 2;
        floorTexture.vScale = WORLD.arenaDepth / 4;
        this.floorMaterial.diffuseTexture = floorTexture;
        this.floorMaterial.specularColor = BABYLON.Color3.Black();

        this.wallMaterial = new BABYLON.StandardMaterial('wall', scene);
        const wallTexture = new BABYLON.Texture(this.arena.wallTexture, scene);
        wallTexture.uScale = 2;
        wallTexture.vScale = 1.2;
        this.wallMaterial.diffuseTexture = wallTexture;
        this.wallMaterial.specularColor = BABYLON.Color3.Black();

        this.frameIdle = new BABYLON.StandardMaterial('frame-idle', scene);
        this.frameIdle.diffuseColor = new BABYLON.Color3(0.26, 0.28, 0.34);
        this.frameIdle.emissiveColor = new BABYLON.Color3(0.08, 0.09, 0.11);
        this.frameIdle.specularColor = BABYLON.Color3.Black();

        this.frameActive = new BABYLON.StandardMaterial('frame-active', scene);
        this.frameActive.diffuseColor = accent;
        this.frameActive.emissiveColor = accent.scale(0.7);
        this.frameActive.specularColor = BABYLON.Color3.Black();

        this.padIdle = new BABYLON.StandardMaterial('pad-idle', scene);
        this.padIdle.diffuseColor = new BABYLON.Color3(0.2, 0.22, 0.28);
        this.padIdle.emissiveColor = new BABYLON.Color3(0.05, 0.06, 0.08);
        this.padIdle.specularColor = BABYLON.Color3.Black();

        this.padActive = new BABYLON.StandardMaterial('pad-active', scene);
        this.padActive.diffuseColor = accent;
        this.padActive.emissiveColor = accent.scale(0.6);
        this.padActive.specularColor = BABYLON.Color3.Black();

        this.accentMaterial = new BABYLON.StandardMaterial('accent', scene);
        this.accentMaterial.emissiveColor = accent;
        this.accentMaterial.diffuseColor = accent;
        this.accentMaterial.specularColor = BABYLON.Color3.Black();

        this.disposables.push(this.floorMaterial, this.wallMaterial, this.frameIdle,
            this.frameActive, this.padIdle, this.padActive, this.accentMaterial,
            floorTexture, wallTexture);
    }

    buildLighting() {
        const scene = this.scene;
        const [r, g, b] = this.arena.sky;
        scene.clearColor = new BABYLON.Color4(r, g, b, 1);

        scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
        const [fr, fg, fb] = this.arena.fog.colour;
        scene.fogColor = new BABYLON.Color3(fr, fg, fb);
        scene.fogDensity = this.arena.fog.density;

        const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.2, 1, 0.3), scene);
        hemi.intensity = this.arena.ambient;
        hemi.groundColor = new BABYLON.Color3(0.25, 0.25, 0.3);

        const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.4, -1, 0.6), scene);
        sun.intensity = 0.55;

        this.disposables.push(hemi, sun);
    }

    // -------------------------------------------------------- geometry ----

    /**
     * @param {string} name
     * @param {number} w @param {number} h @param {number} d
     * @param {number} x @param {number} y @param {number} z
     * @param {BABYLON.Material} material
     * @param {boolean} [solid] whether the hit-scan should collide with it.
     */
    box(name, w, h, d, x, y, z, material, solid = true) {
        const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        mesh.position.set(x, y, z);
        mesh.material = material;
        mesh.isPickable = solid;
        mesh.freezeWorldMatrix();
        if (solid) {
            this.solids.push(mesh);
        }
        this.disposables.push(mesh);
        return mesh;
    }

    buildFloor() {
        const ground = BABYLON.MeshBuilder.CreateGround('ground', {
            width: WORLD.arenaHalfWidth * 2,
            height: WORLD.arenaDepth + 10,
        }, this.scene);
        ground.position.z = WORLD.arenaDepth / 2 - 4;
        ground.material = this.floorMaterial;
        ground.isPickable = true;
        ground.freezeWorldMatrix();
        this.solids.push(ground);
        this.disposables.push(ground);

        // Perimeter walls so there is always something behind a stray shot.
        const h = 5;
        const half = WORLD.arenaHalfWidth;
        this.box('wall-left', 0.4, h, WORLD.arenaDepth + 10, -half, h / 2, WORLD.arenaDepth / 2 - 4, this.wallMaterial);
        this.box('wall-right', 0.4, h, WORLD.arenaDepth + 10, half, h / 2, WORLD.arenaDepth / 2 - 4, this.wallMaterial);
        this.box('wall-behind', half * 2, h, 0.4, 0, h / 2, -4, this.wallMaterial);
    }

    buildWindowWall() {
        const z = WORLD.wallZ;
        const height = WORLD.wallHeight;
        const depth = WORLD.pillarDepth;
        const half = WORLD.arenaHalfWidth;

        // Gap half-width: a window is sized so that standing inside the lane
        // zone gives line of sight to the bot, and standing outside does not.
        const perspective = 1 - WORLD.wallZ / WORLD.targetZ;
        const gapHalf = Arena.toWorldLength(this.lanes.halfZone) * perspective;

        // Wall segments between the windows, from the left edge of the arena
        // to the right.
        const edges = [];
        for (let i = 0; i < this.lanes.count; i += 1) {
            const centre = Arena.toWorldX(this.lanes.centre(i));
            edges.push([centre - gapHalf, centre + gapHalf]);
        }
        let cursor = -half;
        edges.forEach(([left, right], index) => {
            const width = left - cursor;
            if (width > 0.01) {
                this.box(`pillar-${index}`, width, height, depth, cursor + width / 2, height / 2, z, this.wallMaterial);
            }
            cursor = right;
        });
        const lastWidth = half - cursor;
        if (lastWidth > 0.01) {
            this.box('pillar-end', lastWidth, height, depth, cursor + lastWidth / 2, height / 2, z, this.wallMaterial);
        }

        // Lintel across the top, and a frame around each window that lights
        // up when that lane is the one the next note wants.
        const lintelHeight = 0.35;
        this.box('lintel', half * 2, lintelHeight, depth, 0, height + lintelHeight / 2, z, this.wallMaterial);

        edges.forEach(([left, right], index) => {
            const parts = [];
            const frameW = 0.07;
            parts.push(this.box(`frame-l-${index}`, frameW, height, depth + 0.04, left + frameW / 2, height / 2, z, this.frameIdle, false));
            parts.push(this.box(`frame-r-${index}`, frameW, height, depth + 0.04, right - frameW / 2, height / 2, z, this.frameIdle, false));
            parts.push(this.box(`frame-t-${index}`, right - left, frameW, depth + 0.04, (left + right) / 2, height - frameW / 2, z, this.frameIdle, false));
            this.frames.push(parts);
        });
    }

    buildPads() {
        this.pads = [];
        for (let i = 0; i < this.lanes.count; i += 1) {
            const x = Arena.toWorldX(this.lanes.centre(i));
            const pad = BABYLON.MeshBuilder.CreateCylinder(`pad-${i}`, {
                diameter: 1.5, height: 0.06, tessellation: 32,
            }, this.scene);
            pad.position.set(x, 0.03, WORLD.targetZ);
            pad.material = this.padIdle;
            pad.isPickable = false;
            pad.freezeWorldMatrix();
            this.pads.push(pad);
            this.disposables.push(pad);
        }
    }

    buildBackstop() {
        const half = WORLD.arenaHalfWidth;
        this.box('backstop', half * 2, 5, 0.5, 0, 2.5, WORLD.backstopZ, this.wallMaterial);
        // A thin accent stripe along the backstop so tracers have a horizon.
        this.box('backstop-stripe', half * 2, 0.08, 0.02, 0, 1.0, WORLD.backstopZ - 0.3, this.accentMaterial, false);
    }

    buildDecor() {
        const seed = this.level.seed;
        let state = seed >>> 0 || 1;
        const random = () => {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            state >>>= 0;
            return state / 0x100000000;
        };
        const half = WORLD.arenaHalfWidth;

        if (this.arena.decor === 'crates') {
            for (let i = 0; i < 14; i += 1) {
                const side = i % 2 === 0 ? -1 : 1;
                const size = 0.8 + random() * 1.2;
                const x = side * (half - 1.5 - random() * 3.5);
                const z = 4 + random() * 13;
                this.box(`crate-${i}`, size, size, size, x, size / 2, z, this.wallMaterial);
                if (random() < 0.4) {
                    const top = size * 0.7;
                    this.box(`crate-top-${i}`, top, top, top, x + 0.1, size + top / 2, z, this.wallMaterial);
                }
            }
        } else if (this.arena.decor === 'neon') {
            for (let i = 0; i < 10; i += 1) {
                const side = i % 2 === 0 ? -1 : 1;
                const z = 1 + i * 2.2;
                this.box(`neon-strip-${i}`, 0.06, 0.06, 1.6, side * (half - 0.25), 0.9 + (i % 3) * 0.7, z, this.accentMaterial, false);
            }
            for (let i = 0; i < 8; i += 1) {
                const side = i % 2 === 0 ? -1 : 1;
                const h = 2.5 + random() * 2.5;
                const x = side * (half - 1.2 - random() * 2.5);
                const z = 5 + random() * 12;
                this.box(`slab-${i}`, 0.9, h, 0.9, x, h / 2, z, this.wallMaterial);
                this.box(`slab-light-${i}`, 0.95, 0.05, 0.95, x, h + 0.03, z, this.accentMaterial, false);
            }
            // Floor edge glow lines.
            this.box('edge-l', 0.05, 0.03, WORLD.arenaDepth, -half + 0.4, 0.02, WORLD.arenaDepth / 2 - 2, this.accentMaterial, false);
            this.box('edge-r', 0.05, 0.03, WORLD.arenaDepth, half - 0.4, 0.02, WORLD.arenaDepth / 2 - 2, this.accentMaterial, false);
        } else if (this.arena.decor === 'racks') {
            for (let i = 0; i < 12; i += 1) {
                const side = i % 2 === 0 ? -1 : 1;
                const z = 3.5 + Math.floor(i / 2) * 2.4;
                const x = side * (half - 1.4);
                const h = 3.2;
                this.box(`rack-${i}`, 1.2, h, 1.8, x, h / 2, z, this.wallMaterial);
                for (let k = 0; k < 5; k += 1) {
                    if (random() < 0.6) {
                        this.box(`led-${i}-${k}`, 0.04, 0.06, 0.12,
                            x - side * 0.62, 0.5 + k * 0.55, z - 0.6 + random() * 1.2,
                            this.accentMaterial, false);
                    }
                }
            }
        }
    }

    // --------------------------------------------------------- runtime ----

    /**
     * Lights the window and pad for a lane, and dims the rest.
     * @param {number} laneIndex -1 for none.
     */
    setActiveLane(laneIndex) {
        if (this.activeLane === laneIndex) {
            return;
        }
        this.activeLane = laneIndex;
        this.frames.forEach((parts, index) => {
            const material = index === laneIndex ? this.frameActive : this.frameIdle;
            for (const part of parts) {
                part.material = material;
            }
        });
        this.pads.forEach((pad, index) => {
            pad.material = index === laneIndex ? this.padActive : this.padIdle;
        });
    }

    dispose() {
        for (const item of this.disposables) {
            item.dispose();
        }
        this.disposables = [];
        this.solids = [];
    }
}
