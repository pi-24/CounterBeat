/**
 * Electron main process: serves the built client (dist/) via the fixed app://counterbeat origin,
 * opens ONE fullscreen window (never recreated, so run state, audio and pointer lock survive),
 * and toggles windowed mode with Alt+Enter or the Settings option. Main is the source of truth
 * for the live mode and tells the renderer ('cb:windowed'); the renderer persists the setting.
 * CB_SMOKE=1 runs the offline, fresh-profile smoke check against the real (shown) window and exits.
 */
const { app, BrowserWindow, ipcMain, Menu, protocol, net } = require('electron');
const { join, normalize, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSteamService } = require('./steam/SteamService.js');
const { loadSteamConfig } = require('./steam/config.js');
const { registerSteamIpc } = require('./steam/ipc.js');
const { registerSaveIpc } = require('./saveIo.js');
const { windowOptions, isWindowToggle, START_PAGE, APP_SCHEME, APP_URL } = require('./windowConfig.js');

const SMOKE = process.env.CB_SMOKE === '1';
if (SMOKE) {
    // Hermetic smoke run: a throwaway profile (fresh storage, no real saves touched) and NO network at all
    // (every non-local hostname fails to resolve), so the "runs offline" claim is exercised, not assumed.
    const tmp = require('node:fs').mkdtempSync(join(require('node:os').tmpdir(), 'cb-smoke-'));
    app.setPath('userData', join(tmp, 'userData'));
    app.setPath('appData', join(tmp, 'appData'));
    app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND , EXCLUDE localhost');
}
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
    if (shown || !win || win.isDestroyed()) return;
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
registerSaveIpc(ipcMain, app.getPath('appData'));
registerSteamIpc(ipcMain, steam, { achievements: steamConfig.achievements });
app.on('will-quit', () => { steam.release(); setTimeout(() => process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0), 1000).unref(); });
ipcMain.on('cb:quit', () => app.quit());

/** Polls until fn() is truthy (or the timeout passes); resolves to the final value. */
async function waitFor(fn, timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const value = fn();
        if (value || Date.now() >= end) return value;
        await new Promise((r) => setTimeout(r, 50));
    }
}

/**
 * Smoke: the REAL window is shown (so the fullscreen/windowed assertions describe a real window state), offline and with a
 * fresh profile. It clicks through the Play splash with a real mouse event, then asserts the main menu is actually on top
 * (not merely present in the DOM), the web shell is gone, Alt+Enter round-trips, and the process exits cleanly.
 */
async function runSmoke() {
    const finish = (result, code) => {
        clearTimeout(timer);
        console.log(JSON.stringify(result));
        if (win && !win.isDestroyed()) win.destroy();
        process.exitCode = code;
        quitNow(code);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }, 1), 40000);
    const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
    try {
        await createWindow();
        showOnce();
        const fullscreen = await waitFor(() => win.isFullScreen());
        const splash = await js(`
            const until = async (fn) => { for (let i = 0; i < 300; i++) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
            const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
            const up = await until(() => shown(document.getElementById('startOverlay')) && document.querySelector('#trackList')?.children.length > 0);
            // Returning player: skip the first-run calibration/tutorial so the click lands on the menu.
            localStorage.setItem('counterbeat:onboarding', JSON.stringify({ done: true, how: 'skipped', version: 1 }));
            const b = document.querySelector('#startOverlay [data-action="start-play"]').getBoundingClientRect();
            let offline = false;
            try { await fetch('https://example.com/', { mode: 'no-cors' }); } catch { offline = true; }
            return { up, offline, hint: document.querySelector('#startOverlay .start__hint')?.textContent || '',
                x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
        `);
        if (splash.up) {
            win.webContents.sendInputEvent({ type: 'mouseMove', x: splash.x, y: splash.y });
            win.webContents.sendInputEvent({ type: 'mouseDown', x: splash.x, y: splash.y, button: 'left', clickCount: 1 });
            win.webContents.sendInputEvent({ type: 'mouseUp', x: splash.x, y: splash.y, button: 'left', clickCount: 1 });
        }
        const result = await js(`
            const until = async (fn) => { for (let i = 0; i < 150; i++) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
            const visible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
            const splashGone = await until(() => document.getElementById('startOverlay').hidden);
            const menuUp = await until(() => visible(document.getElementById('menuOverlay')) && document.querySelector('#trackList')?.children.length > 0);
            const top = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
            return {
                splashGone,
                menu: menuUp,
                menuOnTop: !!(top && top.closest('#menuOverlay')),
                menuText: document.getElementById('menuOverlay').innerText,
                platform: window.counterbeatDesktop && window.counterbeatDesktop.platform,
                hasQuit: typeof (window.counterbeatDesktop && window.counterbeatDesktop.quit) === 'function',
                headerVisible: visible(document.querySelector('.site-header')),
                guestBannerVisible: visible(document.getElementById('guestNotice')),
                footerVisible: visible(document.querySelector('.site-footer')),
                stageBarVisible: visible(document.querySelector('.stage-bar')),
                railVisible: visible(document.querySelector('.rail')),
                pageScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
                quitVisible: visible(document.querySelector('.desktop-quit')),
                url: location.href,
            };
        `);
        if (process.env.CB_SMOKE_SHOT) {
            const image = await win.webContents.capturePage();
            require('node:fs').writeFileSync(process.env.CB_SMOKE_SHOT, image.toPNG());
        }
        // Exercise the real Alt+Enter path (before-input-event -> applyWindowed); poll for the state instead of sleeping.
        const altEnter = async (expected) => {
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['alt'] });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['alt'] });
            await waitFor(() => windowed === expected && win.isFullScreen() === !expected, 5000);
            return { windowed, fullscreen: win.isFullScreen() };
        };
        const afterAltEnter = await altEnter(true);
        const afterSecondAltEnter = await altEnter(false);
        const ok = splash.up && result.splashGone && result.menu && result.menuOnTop && result.platform === 'desktop' && result.hasQuit && result.quitVisible
            && !result.headerVisible && !result.guestBannerVisible && !result.footerVisible && !result.stageBarVisible && !result.railVisible && !result.pageScrolls
            && afterAltEnter.windowed === true && afterSecondAltEnter.windowed === false;
        finish({ ok, fullscreen, splashUp: splash.up, offline: splash.offline, splashHint: splash.hint, afterAltEnter, afterSecondAltEnter,
            steam: { ...steam.getStatus(), warning: steamWarnings.find((w) => w.includes('disabled')) || steamWarnings[0] || null }, ...result }, ok ? 0 : 1);
    } catch (err) {
        finish({ ok: false, error: String((err && err.message) || err) }, 1);
    }
}

app.whenReady().then(() => {
    registerAppProtocol();
    return SMOKE ? runSmoke() : createWindow();
});
app.on('window-all-closed', () => app.quit());
