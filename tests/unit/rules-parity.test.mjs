// Drift test: data/rules.json -> rulesData.js -> supabase edge-function copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RULES_DATA from '../../src/game/rules/rulesData.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = resolve(root, 'src/game/rules');
const copy = resolve(root, 'supabase/functions/_shared/rules');

test('rulesData.js matches data/rules.json (run npm run sync-rules)', () => {
    const json = JSON.parse(readFileSync(resolve(root, 'data/rules.json'), 'utf8'));
    assert.deepEqual(RULES_DATA, json);
});

test('edge-function rules copy is byte-identical to src/game/rules', () => {
    const a = readdirSync(src).sort();
    const b = readdirSync(copy).sort();
    assert.deepEqual(b, a, 'file lists differ (run npm run sync-rules)');
    for (const file of a) {
        const x = readFileSync(resolve(src, file), 'utf8').replace(/\r\n/g, '\n');
        const y = readFileSync(resolve(copy, file), 'utf8').replace(/\r\n/g, '\n');
        assert.equal(y, x, `${file} drifted (run npm run sync-rules)`);
    }
});

test('client rules modules import the shared rules module', () => {
    const judge = readFileSync(resolve(src, 'Judge.js'), 'utf8');
    assert.match(judge, /from '\.\/rules\.js'/);
    assert.match(readFileSync(resolve(src, 'config.js'), 'utf8'), /from '\.\/rules\.js'/);
});
