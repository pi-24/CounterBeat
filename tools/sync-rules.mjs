/**
 * sync-rules.mjs
 *
 * Copies src/game/rules into supabase/functions/_shared/rules so the edge
 * function replays runs with exactly the code the client plays them with.
 * Run `npm run sync-rules` before `supabase functions deploy`.
 */
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'src/game/rules');
const to = resolve(root, 'supabase/functions/_shared/rules');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`synced ${from} -> ${to}`);
