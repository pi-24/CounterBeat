// AC8: per-difficulty aim model, identical on client and server logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as client from '../../src/game/rules/aim.js';
import { validateRun } from '../../src/game/rules/validateRun.js';
import { validateRun as serverValidate } from '../../supabase/functions/_shared/rules/validateRun.js';
import * as serverAim from '../../supabase/functions/_shared/rules/aim.js';
import { resolveChart } from '../../src/game/rules/charts.js';
import { RULES } from '../../src/game/rules/rules.js';
import { playAndRecord } from '../../tools/lib/scripted-player.mjs';

const DIFFS = ['easy', 'normal', 'hard', 'expert'];

test('Easy/Normal: larger hitbox and no spread; Hard/Expert: full model', () => {
    for (const d of ['easy', 'normal']) {
        const s = client.aimScales(d);
        assert.ok(s.hitboxScale > 1, d);
        assert.equal(s.spreadScale, 0, d);
        assert.equal(client.coneDegrees(600, 600, s.spreadScale), 0);
    }
    for (const d of ['hard', 'expert']) {
        const s = client.aimScales(d);
        assert.equal(s.hitboxScale, 1);
        assert.equal(s.spreadScale, 1);
        assert.ok(client.coneDegrees(600, 600, s.spreadScale) > client.coneDegrees(0, 600, s.spreadScale));
    }
});

test('scales are read from rules.json data', () => {
    for (const d of DIFFS) {
        assert.deepEqual(client.aimScales(d), {
            hitboxScale: RULES.difficulties[d].hitboxScale,
            spreadScale: RULES.difficulties[d].spreadScale,
        });
    }
    assert.match(readFileSync(new URL('../../src/game/rules/aim.js', import.meta.url), 'utf8'), /RULES\.difficulties/);
});

test('hitbox scale grows the hit zone', () => {
    const base = { bodyHalfWidth: 0.4, bodyBottom: 0.1, bodyTop: 0.8, headCentre: 0.85, headRadius: 0.2 };
    const big = client.scaleHitbox(base, 1.3);
    assert.ok(big.headRadius > base.headRadius && big.bodyHalfWidth > base.bodyHalfWidth);
    assert.deepEqual(client.scaleHitbox(base, 1), base);
});

test('client hit geometry (zoneAt) grows with hitboxScale, per difficulty', () => {
    const height = 2;
    const sweep = [0, 0.2, 0.4, 0.5, 0.55, 0.6, 0.7];
    const hits = {};
    for (const d of DIFFS) {
        const box = client.scaleHitbox(client.HITBOX, client.aimScales(d).hitboxScale);
        hits[d] = sweep.map((dx) => client.zoneAt(dx, 1, height, box) !== 'none');
    }
    // A fixed aim sweep: whatever Hard hits, Easy and Normal hit too, and at
    // least one extra point lands only on the larger hitbox.
    assert.deepEqual(hits.hard, hits.expert);
    hits.normal.forEach((h, i) => assert.ok(!h || hits.easy[i], `easy>=normal ${i}`));
    hits.hard.forEach((h, i) => assert.ok(!h || hits.normal[i], `normal>=hard ${i}`));
    assert.ok(hits.easy.some((h, i) => h && !hits.hard[i]));
    assert.equal(client.zoneAt(0, 0.84 * height, height, client.HITBOX), 'head');
    assert.equal(client.zoneAt(0, 0.5, height, client.HITBOX), 'body');
});

test('resolveShot is identical on client and server and has no hitboxScale term', () => {
    const halfZone = 40; // the server only validates Hard/Expert, where hitboxScale is 1
    for (let offset = -120; offset <= 120; offset += 1.5) {
        for (const zone of ['none', 'body', 'head']) {
            const expected = zone !== 'none' && Math.abs(offset) <= halfZone * client.LANE_TOLERANCE;
            const args = { zone, offset, halfZone };
            assert.equal(client.resolveShot(args).hit, expected, `client ${zone} @${offset}`);
            assert.equal(serverAim.resolveShot(args).hit, expected, `server ${zone} @${offset}`);
            // an extra hitboxScale key is ignored
            assert.deepEqual(serverAim.resolveShot({ ...args, hitboxScale: 1.3 }), serverAim.resolveShot(args));
        }
    }
});

test('ranked submissions must be Hard or Expert', () => {
    const level = resolveChart('t:neon:easy');
    const { log } = playAndRecord(level, { mode: 'ranked' });
    for (const v of [validateRun, serverValidate]) {
        const r = v(level, log);
        assert.equal(r.ok, false);
        assert.match(r.reason, /ranked needs hard or expert/);
    }
});

test('server hit/miss equals the client sim on a fixed shot log, per difficulty', () => {
    for (const d of ['hard', 'expert']) { // only these are submittable
        const level = resolveChart(`t:neon:${d}`);
        const { log } = playAndRecord(level, { aimZone: 'body' });
        const a = validateRun(level, log);
        const b = serverValidate(level, log);
        assert.ok(a.ok && b.ok, d);
        assert.deepEqual(b.record, a.record);
        assert.ok(a.record.hits > 0 || a.record.score > 0, d);
    }
});

test('server validateRun matches the client score on every difficulty', () => {
    for (const d of ['hard', 'expert']) { // only these are submittable
        const level = resolveChart(`t:neon:${d}`);
        const { record, log } = playAndRecord(level);
        const a = validateRun(level, log, record.score);
        const b = serverValidate(level, log, record.score);
        assert.ok(a.ok && b.ok, d);
        assert.equal(b.record.score, a.record.score);
        assert.equal(a.record.score, record.score);
    }
});

test('fixed shot log: client and server aim logic agree on every difficulty (incl. Easy/Normal)', () => {
    const shots = [];
    for (const speed of [0, 30, 100, 300, 600]) {
        for (const dx of [0, 0.2, 0.4, 0.6]) {
            for (const fromBottom of [0.05, 0.4, 0.8]) {
                shots.push({ speed, dx, fromBottom });
            }
        }
    }
    for (const d of DIFFS) {
        const s = client.aimScales(d);
        assert.deepEqual(serverAim.aimScales(d), s, d);
        const hb = client.scaleHitbox(client.HITBOX, s.hitboxScale);
        const hbS = serverAim.scaleHitbox(serverAim.HITBOX, s.hitboxScale);
        for (const sh of shots) {
            assert.equal(
                client.coneDegrees(sh.speed, 600, s.spreadScale),
                serverAim.coneDegrees(sh.speed, 600, s.spreadScale), d);
            assert.deepEqual(
                client.zoneAt(sh.dx, sh.fromBottom, 1, hb),
                serverAim.zoneAt(sh.dx, sh.fromBottom, 1, hbS), d);
        }
    }
});

test('Quick Play Hard/Expert logs are submittable; Easy/Normal Quick Play are not', () => {
    for (const d of DIFFS) {
        const level = resolveChart(`t:neon:${d}`);
        const { log } = playAndRecord(level, { mode: 'quickPlay' });
        const r = validateRun(level, log);
        const ranked = d === 'hard' || d === 'expert';
        assert.equal(r.ok, ranked, d);
        assert.equal(serverValidate(level, log).ok, ranked, d);
    }
});
