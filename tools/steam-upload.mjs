/**
 * steam-upload.mjs - the ONLY script in this repo that may run steamcmd. Creator only (AC36).
 *
 *   node tools/steam-upload.mjs --i-am-the-creator-approving --steam-user=<your Steam login>
 *
 * Refuses (non-zero exit, nothing run) unless the flag is given, this is not CI, stdin/stdout are a terminal
 * and the creator types the confirmation phrase. steamcmd asks for the password itself; no credentials or keys
 * are read from, or stored in, the repo. The build is uploaded but never set live (SetLive is empty in the VDF):
 * setting live, pricing, store page publishing and release stay in the Steamworks partner site.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireCreatorApproval } from './lib/release-guard.mjs';
import { readSteamConfig, DEPOT_DIR } from './build-depot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** steamcmd arguments for the generated app build script. */
export function steamcmdArgs({ user, appVdf }) {
    return ['+login', user, '+run_app_build', appVdf, '+quit'];
}

export function parseUser(argv) {
    const a = argv.find((x) => x.startsWith('--steam-user='));
    return a ? a.slice('--steam-user='.length).trim() : '';
}

async function main() {
    const argv = process.argv.slice(2);
    const steam = readSteamConfig();
    const user = parseUser(argv);
    const appVdf = path.join(ROOT, DEPOT_DIR, 'scripts', `app_build_${steam.appId}.vdf`);
    const preflight = () => {
        if (steam.placeholder) return `App ID ${steam.appId} is the placeholder test app. Put the real App ID in data/steam.json.`;
        if (!user) return 'missing --steam-user=<login>.';
        if (!existsSync(appVdf)) return 'no staged depot for this App ID. Run: npm run depot';
        return null;
    };
    await requireCreatorApproval(`upload the depot build for App ID ${steam.appId} with steamcmd`, { preflight });
    // Everything below runs only after the guard above has resolved.
    const r = spawnSync('steamcmd', steamcmdArgs({ user, appVdf }), { stdio: 'inherit' });
    if (r.error) { console.error(`Could not run steamcmd (is it installed and on PATH?): ${r.error.message}`); process.exit(1); }
    process.exit(r.status === null ? 1 : r.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
