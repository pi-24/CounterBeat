// AC27: star data never reaches ranked validation or the edge function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRun } from '../../src/game/rules/validateRun.js';
import { resolveChart } from '../../src/game/rules/charts.js';
import { playAndRecord } from '../../tools/lib/scripted-player.mjs';

const root = resolve(import.meta.dirname, '../..');

test('edge function sources contain no star data', () => {
    const files = readdirSync(resolve(root, 'supabase/functions'), { recursive: true }).filter((p) => /\.(ts|js)$/.test(p));
    assert.ok(files.length > 0);
    for (const p of files) {
        assert.doesNotMatch(readFileSync(resolve(root, 'supabase/functions', p), 'utf8'), /\bstars?\b|starGates|starCost/i, p);
    }
});

test('ranked validator does not import progress', () => {
    assert.doesNotMatch(readFileSync(resolve(root, 'src/game/rules/validateRun.js'), 'utf8'), /progress\/|ProgressStore|localStorage/);
});

test('a modified local star total does not change a ranked validation result', () => {
    const level = resolveChart('t:range:hard');
    assert.ok(level, 'chart resolves');
    const { record, log } = playAndRecord(level, {});
    const before = validateRun(level, log, record.score);
    globalThis.localStorage = { getItem: () => JSON.stringify({ best: { 'range:hard': [true, true, true] } }) };
    try {
        assert.deepEqual(validateRun(level, log, record.score), before);
    } finally {
        delete globalThis.localStorage;
    }
});
