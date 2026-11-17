/**
 * Electron main process: serves the built client (dist/) via the fixed app://counterbeat origin,
 * opens ONE fullscreen window (never recreated, so run state, audio and pointer lock survive),
 * and toggles windowed mode with Alt+Enter or the Settings option. Main is the source of truth
 * for the live mode and tells the renderer ('cb:windowed'); the renderer persists the setting.
 * CB_SMOKE=1 runs a hidden headless smoke check and exits.
 */
const { app, BrowserWindow, ipcMain, Menu, protocol, net } = require('electron');
const { join, normalize, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSteamService } = require('./steam/SteamService.js');
const { loadSteamConfig } = require('./steam/config.js');
const { registerSteamIpc } = require('./steam/ipc.js');
const { windowOptions, isWindowToggle, START_PAGE, APP_SCHEME, APP_URL } = require('./windowConfig.js');

const SMOKE = process.env.CB_SMOKE === '1';
/** Config is read ONCE (one warning if malformed) and shared with the IPC allow-list. */
const steamConfig = loadSteamConfig();
/** Never throws: falls back to a NullSteamService (offline, no achievements) with one warning.
 *  CB_STEAM_FORCE_OFF=1 forces that fallback (the smoke test uses it so the offline path is always exercised). */
const steamWarnings = [];
const steam = createSteamService({
    config: steamConfig,
    forceOff: process.env.CB_STEAM_FORCE_OFF === '1',
    logger: { warn: (m) => { steamWarnings.push(String(m)); console.warn(m); } },
});
/**
 * steamworks.js starts a never-cleared setInterval (runCallbacks, 30 Hz) and a per-window repaint interval and has no
 * teardown API, so with a live Steam client the process can stay alive after app.exit(). Hard-exit shortly after.
 */
function quitNow(code) {
    app.exit(code);
    setTimeout(() => process.exit(code), 1000).unref();
}
// Overlay switches are applied by steamworks.js electronEnableSteamOverlay() inside createSteamService (before app ready).

const DIST = join(__dirname, '..', 'dist');
protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** Serves dist/ under a fixed app://counterbeat origin so storage persists across launches. */
function registerAppProtocol() {
    protocol.handle(APP_SCHEME, async (req) => {
        let path = decodeURIComponent(new URL(req.url).pathname);
        if (path === '/') path = `/${START_PAGE}`;
        const file = normalize(join(DIST, path));
        if (!file.startsWith(DIST + sep)) return new Response('forbidden', { status: 403 });
        return net.fetch(pathToFileURL(file).toString());
    });
}

let win = null;
let windowed = false;
let shown = false;

function showOnce() {
    if (shown || !win || win.isDestroyed() || SMOKE) return;
    shown = true;
    win.show();
}

/** Flips the live mode on the single window and tells the renderer to persist it. */
function applyWindowed(value) {
    const next = Boolean(value);
    if (!win || win.isDestroyed()) return;
    if (next !== windowed) {
        windowed = next;
        win.setFullScreen(!windowed);
        if (windowed) {
            win.setSize(1280, 720);
            win.center();
        }
    }
    win.webContents.send('cb:windowed', windowed);
}

function createWindow() {
    Menu.setApplicationMenu(null);
    win = new BrowserWindow(windowOptions({ windowed: false }));
    win.removeMenu();
    // The renderer reports its saved preference once at start (cb:set-windowed); the window is
    // shown after that is applied so there is no fullscreen flash. Fallback timer if it never does.
    win.once('ready-to-show', () => setTimeout(showOnce, 1500));
    win.webContents.on('before-input-event', (event, input) => {
        if (isWindowToggle(input)) {
            event.preventDefault();
            applyWindowed(!windowed);
        }
    });
    const devUrl = process.env.COUNTERBEAT_DEV_URL;
    return win.loadURL(`${devUrl || APP_URL}/${START_PAGE}`);
}

ipcMain.on('cb:set-windowed', (_e, value) => {
    applyWindowed(value);
    showOnce();
});
registerSteamIpc(ipcMain, steam, { achievements: steamConfig.achievements });
app.on('will-quit', () => { steam.release(); setTimeout(() => process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0), 1000).unref(); });
ipcMain.on('cb:quit', () => app.quit());

/** Headless smoke: menu DOM present, web chrome absent, preload bridge exposed. */
async function runSmoke() {
    const finish = (result, code) => {
        clearTimeout(timer);
        console.log(JSON.stringify(result));
        if (win && !win.isDestroyed()) win.destroy();
        process.exitCode = code;
        quitNow(code);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }, 1), 40000);
    try {
        await createWindow();
        const result = await win.webContents.executeJavaScript(`(async () => {
            const until = async (fn) => { for (let i = 0; i < 350; i++) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
            const visible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
            const menuUp = await until(() => visible(document.getElementById('menuOverlay')) && document.querySelector('#trackList')?.children.length > 0);
            return {
                menu: menuUp,
                platform: window.counterbeatDesktop && window.counterbeatDesktop.platform,
                hasQuit: typeof (window.counterbeatDesktop && window.counterbeatDesktop.quit) === 'function',
                headerVisible: visible(document.querySelector('.site-header')),
                guestBannerVisible: visible(document.getElementById('guestNotice')),
                footerVisible: visible(document.querySelector('.site-footer')),
                stageBarVisible: visible(document.querySelector('.stage-bar')),
                quitVisible: visible(document.querySelector('.desktop-quit')),
                url: location.href,
            };
        })()`);
        const ok = result.menu && result.platform === 'desktop' && result.hasQuit && result.quitVisible
            && !result.headerVisible && !result.guestBannerVisible && !result.footerVisible && !result.stageBarVisible;
        finish({ ok, fullscreen: win.isFullScreen(), steam: { ...steam.getStatus(), warning: steamWarnings.find((w) => w.includes('disabled')) || steamWarnings[0] || null }, ...result }, ok ? 0 : 1);
    } catch (err) {
        finish({ ok: false, error: String((err && err.message) || err) }, 1);
    }
}

app.whenReady().then(() => {
    registerAppProtocol();
    return SMOKE ? runSmoke() : createWindow();
});
app.on('window-all-closed', () => app.quit());
