/**
 * Viewmodel.js
 *
 * The rifle in the bottom-right of the view, built from a handful of boxes
 * and parented to the camera so it moves with the player's look.  On every
 * shot it kicks back, a muzzle flash blinks, and a tracer is drawn to the
 * point the hit-scan reached.  It is drawn in its own rendering group so it
 * never clips through the wall when the player stands close to a window.
 */

const REST = { x: 0.34, y: -0.30, z: 0.98 };
const KICK = { back: 0.1, up: 0.04, pitch: 0.14 };
const RECOVER = 14;   // per second
const FLASH_SECONDS = 0.045;
const TRACER_SECONDS = 0.06;

export class Viewmodel {
    /**
     * @param {BABYLON.Scene} scene
     * @param {BABYLON.Camera} camera
     */
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.kick = 0;          // 0 .. 1, current recoil displacement
        this.flashUntil = 0;
        this.tracerUntil = 0;
        this.clock = 0;

        this.root = new BABYLON.TransformNode('viewmodel', scene);
        this.root.parent = camera;
        this.root.position.set(REST.x, REST.y, REST.z);

        this.buildRifle();
        this.buildFlash();
        this.buildTracer();
    }

    /**
     * @param {string} name
     * @param {number} w @param {number} h @param {number} d
     * @param {number} x @param {number} y @param {number} z
     * @param {BABYLON.Material} material
     */
    part(name, w, h, d, x, y, z, material) {
        const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        mesh.parent = this.root;
        mesh.position.set(x, y, z);
        mesh.material = material;
        mesh.isPickable = false;
        mesh.renderingGroupId = 1;
        return mesh;
    }

    buildRifle() {
        const dark = new BABYLON.StandardMaterial('rifle-dark', this.scene);
        dark.diffuseColor = new BABYLON.Color3(0.13, 0.14, 0.17);
        dark.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        dark.fogEnabled = false;

        const mid = new BABYLON.StandardMaterial('rifle-mid', this.scene);
        mid.diffuseColor = new BABYLON.Color3(0.3, 0.32, 0.38);
        mid.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        mid.fogEnabled = false;

        const accent = new BABYLON.StandardMaterial('rifle-accent', this.scene);
        accent.diffuseColor = new BABYLON.Color3(1, 0.54, 0.16);
        accent.emissiveColor = new BABYLON.Color3(0.5, 0.25, 0.05);
        accent.specularColor = BABYLON.Color3.Black();
        accent.fogEnabled = false;

        this.materials = [dark, mid, accent];

        // receiver, barrel, handguard, magazine, stock, grip, sight
        this.part('receiver', 0.09, 0.09, 0.34, 0, 0, 0, mid);
        this.part('barrel', 0.035, 0.035, 0.42, 0, 0.012, 0.36, dark);
        this.part('handguard', 0.07, 0.07, 0.26, 0, 0, 0.26, dark);
        this.part('magazine', 0.05, 0.16, 0.08, 0, -0.11, 0.02, dark);
        this.part('stock', 0.06, 0.07, 0.22, 0, -0.01, -0.26, dark);
        this.part('grip', 0.045, 0.11, 0.05, 0, -0.08, -0.12, dark);
        this.part('sight', 0.03, 0.03, 0.08, 0, 0.06, 0.02, dark);
        this.part('sight-dot', 0.012, 0.012, 0.012, 0, 0.075, 0.02, accent);
        this.part('rail', 0.03, 0.012, 0.3, 0, 0.051, 0.1, mid);
        this.part('stripe', 0.092, 0.012, 0.1, 0, 0.02, -0.05, accent);
    }

    buildFlash() {
        const material = new BABYLON.StandardMaterial('flash', this.scene);
        material.emissiveColor = new BABYLON.Color3(1, 0.85, 0.5);
        material.diffuseColor = BABYLON.Color3.Black();
        material.opacityTexture = new BABYLON.Texture('images/spark.png', this.scene);
        material.disableLighting = true;
        material.fogEnabled = false;
        material.backFaceCulling = false;

        this.flash = BABYLON.MeshBuilder.CreatePlane('muzzle-flash', { size: 0.22 }, this.scene);
        this.flash.parent = this.root;
        this.flash.position.set(0, 0.012, 0.6);
        this.flash.material = material;
        this.flash.isPickable = false;
        this.flash.renderingGroupId = 1;
        this.flash.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        this.flash.setEnabled(false);

        this.flashLight = new BABYLON.PointLight('flash-light', new BABYLON.Vector3(0, 0, 0), this.scene);
        this.flashLight.diffuse = new BABYLON.Color3(1, 0.75, 0.4);
        this.flashLight.intensity = 0;
        this.flashLight.range = 6;
        this.materials.push(material);
    }

    buildTracer() {
        const material = new BABYLON.StandardMaterial('tracer', this.scene);
        material.emissiveColor = new BABYLON.Color3(1, 0.9, 0.6);
        material.disableLighting = true;
        material.fogEnabled = false;
        this.materials.push(material);

        this.tracer = BABYLON.MeshBuilder.CreateLines('tracer', {
            points: [BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()],
            updatable: true,
        }, this.scene);
        this.tracer.color = new BABYLON.Color3(1, 0.9, 0.6);
        this.tracer.isPickable = false;
        this.tracer.setEnabled(false);
    }

    /**
     * @param {BABYLON.Vector3} from world-space muzzle position
     * @param {BABYLON.Vector3} to world-space hit point
     * @param {boolean} hit colours the tracer green on a hit, red on a miss.
     */
    fire(from, to, hit) {
        this.kick = 1;
        this.flashUntil = this.clock + FLASH_SECONDS;
        this.tracerUntil = this.clock + TRACER_SECONDS;

        this.flash.setEnabled(true);
        this.flash.rotation.z = Math.random() * Math.PI;
        this.flashLight.position.copyFrom(from);
        this.flashLight.intensity = 2.2;

        BABYLON.MeshBuilder.CreateLines('tracer', {
            points: [from, to], instance: this.tracer,
        });
        this.tracer.color = hit ? new BABYLON.Color3(0.49, 1, 0.73) : new BABYLON.Color3(1, 0.4, 0.4);
        this.tracer.setEnabled(true);
    }

    /** @returns {BABYLON.Vector3} world position of the muzzle. */
    get muzzlePosition() {
        return BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(0, 0.012, 0.58), this.root.getWorldMatrix());
    }

    /** @param {number} dt seconds */
    update(dt) {
        this.clock += dt;
        this.kick += (0 - this.kick) * Math.min(1, RECOVER * dt);

        this.root.position.set(
            REST.x,
            REST.y + KICK.up * this.kick,
            REST.z - KICK.back * this.kick,
        );
        this.root.rotation.x = -KICK.pitch * this.kick;

        if (this.clock > this.flashUntil) {
            this.flash.setEnabled(false);
            this.flashLight.intensity = 0;
        }
        if (this.clock > this.tracerUntil) {
            this.tracer.setEnabled(false);
        }
    }

    dispose() {
        this.root.dispose(false, true);
        this.tracer.dispose();
        this.flashLight.dispose();
        for (const material of this.materials) {
            material.dispose(true, true);
        }
    }
}
