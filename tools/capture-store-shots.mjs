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
// seeds 0-5 pick The Range, Lo-fi Drift, Neon Alley, Breakneck, Server Vault, Overclock (ink Range, ink Neon, bone Vault). atlas_clean=1 (set by the capture window) drops
// the web guest wording and the placeholder-music tag. Any PNG in store/screenshots counts toward the checker's minimum.
const SHOTS = [
    ['01-neon-play', 'play', 2, 20],
    ['02-breakneck-play', 'play', 3, 18],
    ['03-vault-play', 'play', 4, 26],
    ['04-overclock-play', 'play', 5, 25],
    ['05-overclock-early', 'play', 5, 12],
    ['06-vault-mid', 'play', 4, 21],
    ['07-results', 'results', 3, 8],
    ['08-range-play', 'play', 0, 20],
];

const out = path.resolve(process.argv[2] ?? 'store/screenshots');
const env = { ...process.env, CB_SHOT_DIR: out, CB_SHOTS: JSON.stringify(SHOTS) };
delete env.ELECTRON_RUN_AS_NODE;
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['tools/lib/electron-store-capture.cjs'], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
