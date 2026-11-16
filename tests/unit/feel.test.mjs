import test from 'node:test';
import assert from 'node:assert/strict';
import { arcColour, arcBand, arcFill, ARC_COLOURS, arcTickSpeeds } from '../../src/game/feel/speedArc.js';
import { FlashLimiter } from '../../src/game/feel/flashLimiter.js';
import { effectPolicy, HIT_STOP_MS } from '../../src/game/feel/reducedEffects.js';
import { FeelController } from '../../src/game/feel/FeelController.js';
import { FeedbackBus } from '../../src/game/providers/FeedbackBus.js';
import { DEFAULT_SETTINGS } from '../../src/game/rules/config.js';

test('arc is green at or below 20 u/s and changes band above', () => {
    assert.equal(arcColour(0), ARC_COLOURS.perfect);
    assert.equal(arcColour(20), ARC_COLOURS.perfect);
    assert.equal(arcColour(-20), ARC_COLOURS.perfect);
    assert.equal(arcBand(20.01), 'good');
    assert.equal(arcBand(65), 'good');
    assert.equal(arcBand(65.1), 'loose');
    assert.equal(arcBand(140), 'loose');
    assert.equal(arcBand(141), 'fast');
    assert.notEqual(arcColour(21), ARC_COLOURS.perfect);
});

test('arc fill is clamped', () => {
    assert.equal(arcFill(-50, 100), 0.5);
    assert.equal(arcFill(500, 100), 1);
    assert.equal(arcFill(5, 0), 0);
});

test('flash limiter allows at most 3 per rolling second', () => {
    const l = new FlashLimiter();
    let played = 0;
    for (let i = 0; i < 100; i++) if (l.tryFlash(i * 0.01)) played++; // 100 attempts in 1s
    assert.equal(played, 3);
    assert.equal(l.tryFlash(1.2), true); // oldest has aged out
    assert.equal(new FlashLimiter(10).max, 3, 'cannot be configured above 3');
});

test('reduced effects disables pulse, camera kick and hit-stop', () => {
    const on = effectPolicy({ reducedEffects: true });
    assert.deepEqual([on.pulse, on.cameraKick, on.hitStop], [false, false, false]);
    assert.equal(on.flashesPerSecond, 3);
    const off = effectPolicy({ reducedEffects: false });
    assert.deepEqual([off.pulse, off.cameraKick, off.hitStop], [true, true, true]);
    assert.ok(HIT_STOP_MS >= 30 && HIT_STOP_MS <= 50);
    assert.equal(DEFAULT_SETTINGS.reducedEffects, false);
});

function rig(reduced) {
    const bus = new FeedbackBus();
    const calls = { pulse: 0, kick: 0, flash: 0 };
    let t = 0;
    const feel = new FeelController(bus, { get: () => reduced }, {
        arena: { pulse: () => calls.pulse++ }, camera: { kick: () => calls.kick++ }, hud: { flashPerfect: () => calls.flash++ },
    }, () => t);
    return { bus, calls, feel, setT: (v) => { t = v; } };
}

test('feel controller drives effects, hit-stop is time limited', () => {
    const { bus, calls, feel, setT } = rig(false);
    bus.emit('beat', {});
    bus.emit('hit', { perfect: true });
    assert.deepEqual([calls.pulse, calls.kick], [1, 1]);
    assert.equal(feel.frozen, true);
    setT(0.1);
    assert.equal(feel.frozen, false);
});

test('feel controller with reduced effects: no pulse/kick/hit-stop, flashes capped', () => {
    const { bus, calls, feel } = rig(true);
    bus.emit('beat', {});
    bus.emit('hit', { perfect: true });
    assert.deepEqual([calls.pulse, calls.kick, feel.frozen], [0, 0, false]);
    for (let i = 0; i < 20; i++) bus.emit('perfectStop', {});
    assert.equal(calls.flash, 1);
});

import { Conductor } from '../../src/game/rules/Conductor.js';
import { SPEED_GRADE } from '../../src/game/rules/config.js';
import { STOP_SPEED } from '../../src/game/rules/rules.js';
import { readFileSync } from 'node:fs';

test('arc ticks sit exactly on the colour band boundaries', () => {
    const ticks = arcTickSpeeds(SPEED_GRADE);
    assert.deepEqual(ticks, { perfect: STOP_SPEED.perfect, good: STOP_SPEED.good, loose: STOP_SPEED.loose });
    assert.equal(arcBand(ticks.loose), 'loose');
    assert.equal(arcBand(ticks.loose + 1), 'fast');
    assert.equal(arcBand(ticks.good), 'good');
    assert.equal(arcBand(ticks.perfect), 'perfect');
});

test('Conductor.update returns true once per beat, so the pulse can be emitted', () => {
    let t = 0;
    const c = new Conductor(() => t, 120);
    c.start();
    const beats = [];
    for (t = 0; t < 2.01; t += 0.016) if (c.update()) beats.push(Math.floor(c.beatPosition));
    assert.deepEqual(beats, [0, 1, 2, 3, 4]);
});

test('the real camera exposes kick()', () => {
    // Babylon cannot load under node, so check the source declares the method.
    const src = readFileSync(new URL('../../src/game/fps/FpsCamera.js', import.meta.url), 'utf8');
    assert.match(src, /^\s+kick\(\w+\)\s*\{/m);
});

test('shatter reaches the field even under Reduced Effects', () => {
    const calls = [];
    const bus = new FeedbackBus();
    const settings = { get: (k) => (k === 'reducedEffects' ? true : DEFAULT_SETTINGS[k]) };
    new FeelController(bus, settings, { field: { shatter: (p, o) => calls.push([p, o]) } });
    bus.emit('shatter', { point: 'p', headshot: true, perfect: false });
    assert.deepEqual(calls, [['p', { headshot: true, perfect: false }]]);
});

test('arc colour and ticks share one grades object', () => {
    const grades = { pinPoint: 10, tight: 30, loose: 50 };
    assert.equal(arcColour(10, grades), ARC_COLOURS.perfect);
    assert.equal(arcColour(11, grades), ARC_COLOURS.good);
    assert.deepEqual(arcTickSpeeds(grades), { perfect: 10, good: 30, loose: 50 });
});

test('hitmarker and beat ring share the flash limiter (<= 3 flashes/s total)', () => {
    const bus = new FeedbackBus();
    let n = 0;
    const hud = { flashPerfect: () => n++, flashBeat: () => n++, showHitmarker: () => n++ };
    new FeelController(bus, { get: () => true }, { hud }, () => 0.5);
    for (let i = 0; i < 10; i++) { bus.emit('beat', {}); bus.emit('hit', {}); bus.emit('perfectStop', {}); }
    assert.equal(n, 3);
    n = 0;
    new FeelController(bus, { get: () => false }, { hud }, () => 0.5);
    bus.emit('hit', {}); bus.emit('hit', {}); bus.emit('hit', {}); bus.emit('hit', {}); bus.emit('perfectStop', {});
    assert.equal(n, 5 + 0, 'without Reduced Effects hit confirmation is never dropped');
});

test('under the flash cap a fast beat never crowds out hit confirmation', () => {
    const bus = new FeedbackBus();
    const seen = { beat: 0, hit: 0 };
    let t = 0;
    const hud = { flashPerfect() {}, flashBeat: () => seen.beat++, showHitmarker: () => seen.hit++ };
    new FeelController(bus, { get: () => true }, { hud }, () => t);
    // 4 beats/s (fast chart) with a hit landing just after every beat, for 5 seconds.
    for (let i = 0; i < 20; i++) {
        t = i * 0.25; bus.emit('beat', {});
        t += 0.01; bus.emit('hit', {});
    }
    assert.ok(seen.hit >= 10, `hits must keep a slot every second (got ${seen.hit})`);
    assert.ok(seen.beat + seen.hit <= 3 * 5 + 1, 'total flashes stay within the 3/s cap');
});
