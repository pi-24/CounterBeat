/** Writes CREDITS.md from the manifests (`--check` verifies it is current). */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from './validate-assets.mjs';
import { buildCredits, creditsMarkdown } from '../src/ui/creditsData.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function currentCredits(root = ROOT) {
    const m = {};
    for (const n of ['tracks', 'themes', 'targets', 'crosshairs', 'art']) m[n] = loadManifest(`${n}.json`, root);
    return creditsMarkdown(buildCredits(m));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const file = resolve(ROOT, 'CREDITS.md');
    const md = currentCredits();
    if (process.argv.includes('--check')) {
        if (!existsSync(file) || readFileSync(file, 'utf8') !== md) { console.error('CREDITS.md is stale; run node tools/gen-credits.mjs'); process.exit(1); }
    } else writeFileSync(file, md);
}
