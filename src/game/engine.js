/**
 * engine.js
 *
 * The single doorway to Babylon.js.  Everything the game needs is imported
 * here by its deep path, so the bundler can drop the rest of the engine, and
 * the handful of modules that register themselves by side effect (ray
 * picking, sprites, particles) are pulled in once, deliberately, rather than
 * discovered missing at runtime.
 *
 * Nothing outside this file imports from "@babylonjs/core" directly.
 */

// Side-effect registrations.
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Sprites/spriteSceneComponent';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Engines/Extensions/engine.alpha';
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture';
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Rendering/boundingBoxRenderer';

export { Engine } from '@babylonjs/core/Engines/engine';
export { Scene } from '@babylonjs/core/scene';
export { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { Axis } from '@babylonjs/core/Maths/math.axis';
export { Ray } from '@babylonjs/core/Culling/ray';
export { Camera } from '@babylonjs/core/Cameras/camera';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { PointLight } from '@babylonjs/core/Lights/pointLight';
export { SpriteManager } from '@babylonjs/core/Sprites/spriteManager';
export { Sprite } from '@babylonjs/core/Sprites/sprite';
export { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';

import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';

/** The subset of MeshBuilder the arena and effects use. */
export const MeshBuilder = Object.freeze({
    CreateBox, CreateGround, CreateCylinder, CreateTorus, CreatePlane, CreateLines,
});
