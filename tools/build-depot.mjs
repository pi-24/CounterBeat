/**
 * build-depot.mjs - produces the Windows Steam depot content LOCALLY. It never uploads anything and never
 * runs steamcmd (that lives only in tools/steam-upload.mjs, behind the creator-approval guard).
 *
 *   npm run depot                              vite build + electron-builder (dir target) + stage + VDFs
 *   node tools/build-depot.mjs --skip-build    stage the existing release/win-unpacked only
 *
 * Output (release/depot/, git-ignored):
 *   content/                        the game files for the depot
 *   scripts/app_build_<APPID>.vdf
 *   scripts/depot_build_<DEPOTID>.vdf
 * The App ID comes from data/steam.json; the depot ID is `depotId` there if set, else Steam's convention (App ID + 1).
 * The unpacked path and exe name come from electron-builder.json.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEPOT_DIR = path.join('release', 'depot');

/**
 * Where electron-builder puts the unpacked Windows build and what the exe is called, derived from
 * electron-builder.json (directories.output, productName) rather than assumed.
 */
export function builderLayout(file = path.join(ROOT, 'electron-builder.json')) {
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    const output = (cfg.directories && cfg.directories.output) || 'dist';
    const exe = `${cfg.productName || cfg.appId}.exe`;
    return { unpacked: path.join(output, 'win-unpacked'), exe };
}

/** Quote a VDF value (backslashes and quotes escaped). */
function q(v) { return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

/** Read and validate the Steam config (depotId optional, defaults to appId + 1). Returns {appId, depotId, placeholder}. */
export function readSteamConfig(file = path.join(ROOT, 'data', 'steam.json')) {
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    const appId = Number(cfg.appId);
    if (!Number.isInteger(appId) || appId <= 0) throw new Error(`data/steam.json: appId must be a positive integer, got ${cfg.appId}`);
    let depotId = appId + 1;
    if (cfg.depotId !== undefined) {
        depotId = Number(cfg.depotId);
        if (!Number.isInteger(depotId) || depotId <= 0) throw new Error(`data/steam.json: depotId must be a positive integer, got ${cfg.depotId}`);
    }
    return { appId, depotId, placeholder: cfg.appIdIsPlaceholder === true };
}

/**
 * Generated app build VDF. "SetLive" is deliberately empty, so even an upload never goes live by itself;
 * the creator sets a build live in the Steamworks partner site.
 */
export function appBuildVdf({ appId, depotId, description = 'CounterBeat local depot build' }) {
    return [
        '"AppBuild"', '{',
        `\t"AppID" ${q(appId)}`,
        `\t"Desc" ${q(description)}`,
        '\t"Preview" "0"',
        '\t"SetLive" ""',
        '\t"ContentRoot" "..\\content\\"',
        '\t"BuildOutput" "..\\output\\"',
        '\t"Depots"', '\t{',
        `\t\t${q(depotId)} ${q(`depot_build_${depotId}.vdf`)}`,
        '\t}', '}', '',
    ].join('\n');
}

/** Generated depot build VDF: everything under content/ except debug symbols. */
export function depotBuildVdf({ depotId }) {
    return [
        '"DepotBuild"', '{',
        `\t"DepotID" ${q(depotId)}`,
        '\t"FileMapping"', '\t{',
        '\t\t"LocalPath" "*"', '\t\t"DepotPath" "."', '\t\t"Recursive" "1"',
        '\t}',
        '\t"FileExclusion" "*.pdb"', '}', '',
    ].join('\n');
}

/** Stage the unpacked Electron output and write the VDFs. Returns the paths written. */
export function stageDepot({ root = ROOT, layout = builderLayout(path.join(root, 'electron-builder.json')), unpacked = layout.unpacked, exe = layout.exe, out = DEPOT_DIR, steam = readSteamConfig(path.join(root, 'data', 'steam.json')) } = {}) {
    const src = path.join(root, unpacked);
    if (!existsSync(path.join(src, exe))) throw new Error(`${unpacked}/${exe} not found; run without --skip-build`);
    const outDir = path.join(root, out);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(path.join(outDir, 'scripts'), { recursive: true });
    mkdirSync(path.join(outDir, 'output'), { recursive: true });
    cpSync(src, path.join(outDir, 'content'), { recursive: true });
    const appVdf = path.join(outDir, 'scripts', `app_build_${steam.appId}.vdf`);
    const depotVdf = path.join(outDir, 'scripts', `depot_build_${steam.depotId}.vdf`);
    writeFileSync(appVdf, appBuildVdf(steam));
    writeFileSync(depotVdf, depotBuildVdf(steam));
    return { content: path.join(outDir, 'content'), appVdf, depotVdf };
}

function main() {
    const steam = readSteamConfig();
    if (!process.argv.includes('--skip-build')) {
        const r = spawnSync('npm run electron:build', { cwd: ROOT, stdio: 'inherit', shell: true });
        if (r.status !== 0) { console.error('electron:build failed'); process.exit(r.status || 1); }
    }
    const out = stageDepot({ steam });
    console.log(`Depot staged locally (nothing uploaded):\n  ${out.content}\n  ${out.appVdf}\n  ${out.depotVdf}`);
    if (steam.placeholder) console.log(`NOTE: App ID ${steam.appId} is the placeholder test app. The creator replaces it in data/steam.json.`);
    console.log('Uploading is for the creator only: see docs/steam-handoff.md (tools/steam-upload.mjs).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
