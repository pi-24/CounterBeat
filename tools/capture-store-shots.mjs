/**
 * capture-store-shots.mjs - captures the Steam store gameplay screenshots (1920x1080) from the DESKTOP build:
 * the Electron shell's own preload and app:// origin serving dist/, so no web header or guest banner shows.
 * Uses the atlas URL hook (?atlas_scene=), which keeps progress in memory and submits nothing.
 *
 *   npm run build
 *   node tools/capture-store-shots.mjs [outDir]
 *
 * Dev tool only: it never ships. CB_SOFTWARE_GL=1 forces the SwiftShader renderer on machines without a GPU.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// name, atlas scene, seed, simulated seconds. Play scenes show a scripted bot run (live score, combo, accuracy);
// seeds 0-3 pick Neon Alley, Breakneck, Server Vault, Overclock. atlas_clean=1 (set by the capture window) drops
// the web guest wording and the placeholder-music tag. Any PNG in store/screenshots counts toward the checker's minimum.
const SHOTS = [
    ['01-neon-play', 'play', 0, 20],
    ['02-breakneck-play', 'play', 1, 18],
    ['03-vault-play', 'play', 2, 26],
    ['04-overclock-play', 'play', 3, 25],
    ['05-overclock-early', 'play', 3, 12],
    ['06-vault-mid', 'play', 2, 21],
    ['07-results', 'results', 1, 8],
];

const out = path.resolve(process.argv[2] ?? 'store/screenshots');
const env = { ...process.env, CB_SHOT_DIR: out, CB_SHOTS: JSON.stringify(SHOTS) };
delete env.ELECTRON_RUN_AS_NODE;
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['tools/lib/electron-store-capture.cjs'], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
