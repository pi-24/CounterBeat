// AC8: the Easy/Normal larger hitbox, through the real TargetField pick path
// (real Babylon scene on a NullEngine, real sprite picking), not only the pure function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../helpers/babylon-hooks.mjs', import.meta.url);

const { TargetField } = await import('../../src/game/fps/TargetField.js');
const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine.js');
const { Scene } = await import('@babylonjs/core/scene.js');
const { FreeCamera } = await import('@babylonjs/core/Cameras/freeCamera.js');
const { Vector3 } = await import('@babylonjs/core/Maths/math.vector.js');
const { Ray } = await import('@babylonjs/core/Culling/ray.js');
const { RULES } = await import('../../src/game/rules/rules.js');
const { aimScales, HITBOX } = await import('../../src/game/rules/aim.js');

const engine = new NullEngine();

/** Spawns one bot and fires a ray at `dx` world units right of its centre, at body height. */
function shootAt(difficulty, dx) {
    const scene = new Scene(engine);
    const camera = new FreeCamera('cam', new Vector3(0, 1.2, -8), scene);
    camera.setTarget(new Vector3(0, 1.2, 0));
    camera.getViewMatrix(true);
    camera.getProjectionMatrix(true);
    scene.activeCamera = camera;
    const field = new TargetField(
        scene, { centre: () => 0 }, { camera, right: new Vector3(1, 0, 0) },
        [0, 1, 1], undefined, aimScales(difficulty).hitboxScale,
    );
    const entry = field.spawn({ lane: 0, index: 0, time: 1 });
    const sprite = entry.sprite;
    const aim = new Vector3(sprite.position.x + dx, sprite.position.y, sprite.position.z);
    const origin = camera.position.clone();
    const ray = new Ray(origin, aim.subtract(origin).normalize(), 100);
    const result = field.pick(ray);
    scene.dispose();
    return { result };
}

test('hit zone width grows with hitboxScale through TargetField.pick', () => {
    const probe = shootAt('hard', 0);
    assert.notEqual(probe.result.zone, 'none', 'dead-centre ray hits');
    // A ray just outside the Hard body width but inside the Easy one.
    const dx = HITBOX.bodyHalfWidth * (1 + (RULES.difficulties.easy.hitboxScale - 1) / 2);
    assert.equal(shootAt('hard', dx).result.zone, 'none', 'hard misses');
    assert.equal(shootAt('expert', dx).result.zone, 'none', 'expert misses');
    assert.notEqual(shootAt('easy', dx).result.zone, 'none', 'easy hits');
    assert.ok(shootAt('easy', dx).result.entry, 'easy hit resolves the note');
    assert.ok(RULES.difficulties.normal.hitboxScale > 1);
});
