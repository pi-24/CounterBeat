/**
 * GameApp.js
 *
 * Boots the 3D engine, loads the audio, and switches between the three
 * screens.  The page passes in a `services` object, which is the only
 * channel between the game and the rest of the website: the screens ask it
 * who is playing and hand it finished runs, and it is the page's job to put
 * those in local storage.
 */
import { practiceKeyFree } from './modes/practice.js';
import { requestFullscreenFromGesture, lockPromptNeeded, mayRequestFullscreen } from './onboarding/startFlow.js';
import { Hud } from './fps/Hud.js';
import { Input } from './Input.js';
import { loadStreamed } from '../audio/streamLoader.js';
import { audio as sharedAudio } from './audio/AudioEngine.js';
import { settings as sharedSettings } from './Settings.js';
import { MenuScreen } from './screens/MenuScreen.js';
import { SettingsPanel } from './screens/SettingsPanel.js';
import { Calibration } from './screens/Calibration.js';
import { SongLibrary } from './library/SongLibrary.js';
import { assets, themeProvider } from './providers/index.js';
import { CosmeticsPanel } from './screens/CosmeticsPanel.js';
import { toast } from '../ui/Toast.js';
import { store } from '../core/Storage.js';
import { MainMenu } from '../ui/MainMenu.js';
import { TutorialPanel } from '../ui/Tutorial.js';
import { mountGameSettings } from '../ui/Settings.js';
import { shouldAutoStart, markOnboardingDone } from './onboarding/firstRun.js';
import { dailyChartId } from './rules/charts.js';

/**
 * @typedef {object} GameServices
 * @property {() => string} getPlayerName
 * @property {() => boolean} isLoggedIn
 * @property {(chartId:string) => boolean} hasPassed
 * @property {(chartId:string) => number} getPersonalBest
 * @property {import('./progress/store.js').ProgressStore} progress stars and cosmetics (local, synced, never server-verified)
 * @property {(record:object, log:object, runToken?:Promise<string|null>|null) => Promise<{personalBest:boolean, saved:boolean, rejected?:boolean, score?:number}>} onRunComplete
 * @property {(judgement:object) => void} onJudgement
 * @property {(chartId:string) => (Promise<string|null>|null)} [startRun] asks the server for
 *   a run token when the run will be ranked; null when it will not be
 */

export class GameApp {
    /**
     * @param {object} options
     * @param {HTMLCanvasElement} options.canvas
     * @param {HTMLElement} options.stage the element that goes fullscreen
     * @param {HTMLElement} options.hudRoot
     * @param {{loading:HTMLElement, menu:HTMLElement, pause:HTMLElement,
     *          result:HTMLElement, calibration:HTMLElement}} options.overlays
     * @param {HTMLElement} options.settingsForm
     * @param {GameServices} options.services
     * @param {{chartId:string, log:object}} [options.replay] open this replay first
     * @param {{clicked:boolean}} [options.early] the page's early Play splash state
     * @param {boolean} [options.skipStart] no Play splash (screenshot hook and replay links)
     * @param {{read:Function, write:Function}} [options.storage] holds the first-run flag
     */
    constructor(options) {
        this.canvas = options.canvas;
        this.stage = options.stage;
        this.services = options.services;
        this.menuOverlay = options.overlays.menu;
        this.pauseOverlay = options.overlays.pause;
        this.resultOverlay = options.overlays.result;
        this.loadingOverlay = options.overlays.loading;
        /** Set by the page when the Play splash was clicked before this module finished loading. */
        this.early = options.early ?? { clicked: false };
        this.skipStart = Boolean(options.skipStart);
        this.storage = options.storage ?? store;
        this.startOverlay = document.getElementById('startOverlay');
        this.lockPrompt = document.getElementById('lockPrompt');

        this.audio = sharedAudio;
        this.settings = sharedSettings;
        this.input = new Input();
        this.hud = new Hud(options.hudRoot);
        this.settingsPanel = new SettingsPanel(options.settingsForm, this.settings);
        this.calibration = new Calibration({
            overlay: options.overlays.calibration,
            audio: this.audio,
            settings: this.settings,
        });
        this.cosmetics = new CosmeticsPanel(
            options.settingsForm.querySelector('#cosmetics'), this.services.progress, themeProvider, this.settings,
        );
        this.settingsPanel.onCalibrate = () => this.calibration.open();
        this.tutorialPanel = new TutorialPanel(this.stage, {
            onSkip: () => this.skipTutorial(),
            onRepeat: () => this.play?.tutorialProgress?.repeatStage(),
        });
        /** Mode chosen on the main menu: campaign | quickPlay | practice. */
        this.playMode = 'quickPlay';
        this.mainMenu = new MainMenu(this.menuOverlay, {
            onMode: (mode) => {
                this.playMode = mode;
                this.current?.renderTracks?.(); // Practice opens every track
            },
            onDaily: () => this.current?.start?.(dailyChartId()),
            onTutorial: () => this.startTutorial(),
        });
        mountGameSettings(options.settingsForm.querySelector('#gameSettings'), this.settings, {
            onCalibrate: () => this.calibration.open({ auto: false }),
            onTutorial: () => this.startTutorial(),
        });
        this.applyAudioSettings();
        this.settings.onChange(() => this.applyAudioSettings());
        this.library = SongLibrary.available ? new SongLibrary(this.audio) : null;
        /** A replay to open as soon as the menu would otherwise show. */
        this.pendingReplay = options.replay ?? null;

        /** @type {{enter:Function, exit:Function, update:Function}|null} */
        this.current = null;
        this.switching = false;
        /** Bumped on every screen switch, so only the latest one clears `switching`. */
        this.switchId = 0;
    }

    /**
     * The menu is DOM, so it comes up as soon as this module has loaded.  The 3D engine (the bulk
     * of the download) and the play/result screens are imported behind it by `init3d`, and every
     * 3D-dependent step waits on `ready3d`.
     */
    async boot() {
        this.ready3d = this.init3d();
        this.ready3d.catch(() => {}); // surfaced below; no unhandled-rejection noise while the menu shows
        this.settingsPanel.init();
        this.mainMenu.mount();
        this.bindControls();

        this.loadingOverlay.hidden = true;
        this.bindStart();
        if (this.pendingReplay) {
            const { chartId, log } = this.pendingReplay;
            this.pendingReplay = null;
            this.startAudioStreaming();
            await this.showReplay(chartId, log);
            return;
        }
        await this.showMenu();
        // No sound blocks start-up: music and effects stream in behind the menu.
        this.startAudioStreaming();
        await this.ready3d;
    }

    startAudioStreaming() {
        // `audioStreaming` settles when every background sound has arrived.  Nothing waits on it
        // to play; it exists so tooling can tell when the page has stopped fetching.
        this.audioStreaming = loadStreamed(this.audio, assets.audioManifest(),
            (key) => { if (key === 'music-menu') this.playMenuMusicWhenReady(); })
            .then((streamed) => streamed.background)
            .catch(() => {});
    }

    /** Imports and creates the 3D engine, camera and the screens that need them. */
    async init3d() {
        const [{ Engine, Scene }, { FpsCamera }, { PlayScreen }, { ResultScreen }, { Showcase }] = await Promise.all([
            import('./engine.js'),
            import('./fps/FpsCamera.js'),
            import('./screens/PlayScreen.js'),
            import('./screens/ResultScreen.js'),
            import('./fps/Showcase.js'),
        ]);
        this.PlayScreen = PlayScreen;
        this.ResultScreen = ResultScreen;
        this.Showcase = Showcase;
        this.engine = new Engine(this.canvas, true, {
            antialias: true,
            adaptToDeviceRatio: true,
            preserveDrawingBuffer: false,
            stencil: false,
            // Laptops with two GPUs: ask for the fast one.
            powerPreference: 'high-performance',
        });
        this.scene = new Scene(this.engine);
        // The game does its own hit-scan; the engine never needs to pick
        // under the pointer, which it would otherwise do on every move and click.
        this.scene.skipPointerMovePicking = true;
        this.scene.skipPointerDownPicking = true;
        this.scene.skipPointerUpPicking = true;
        this.camera = new FpsCamera(this.scene, this.canvas, this.settings);

        this.engine.runRenderLoop(() => {
            const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
            if (this.current && !this.switching) {
                this.current.update(dt);
            }
            this.updateLockPrompt();
            this.scene.render();
        });
        window.addEventListener('resize', () => this.engine.resize());
    }

    // --------------------------------------------------------- onboarding ----

    applyAudioSettings() {
        this.audio.setVolumes(this.settings.get('musicVolume'), this.settings.get('sfxVolume'));
    }

    /** The in-game Play splash: one click goes fullscreen, then first-run setup or the menu. */
    bindStart() {
        if (!this.startOverlay || this.skipStart || this.pendingReplay) {
            if (this.startOverlay) {
                this.startOverlay.hidden = true;
            }
            return;
        }
        this.startOverlay.hidden = false;
        const button = this.startOverlay.querySelector('[data-action="start-play"]');
        let busy = false;
        const go = async (insideGesture) => {
            if (busy) {
                return;
            }
            busy = true;
            // Fullscreen must be requested synchronously inside a click.  An early click was
            // already handled by the page (it requested fullscreen in its own handler), so
            // this only shows the menu: no second fullscreen or pointer-lock attempt.
            if (mayRequestFullscreen(this.early, insideGesture)) {
                this.enterFullscreen();
            }
            try {
                await this.audio.unlock();
            } catch {
                // No audio is not a reason to trap the player on the splash.
            }
            this.startOverlay.hidden = true;
            if (shouldAutoStart(this.storage)) {
                this.runFirstRun();
            } else {
                this.playMenuMusicWhenReady();
            }
        };
        button.addEventListener('click', () => go(true));
        button.textContent = 'Click to play';
        // The page shows this splash before the engine loads; a click that came early is honoured now.
        // Focus the button before the overlay can be hidden, never after.
        button.focus();
        if (this.early.clicked) {
            go(false);
        }
    }

    /** First launch: short calibration (skippable), then the tutorial (skippable). */
    /** Menu music streams in after the menu is up; start it if the player is already there. */
    playMenuMusicWhenReady() {
        const ready = this.audio.ready && this.audio.context.state === 'running';
        if (ready && this.startOverlay?.hidden && this.current instanceof MenuScreen
            && !this.audio.musicKey && this.audio.has('music-menu')) {
            this.audio.resetMusicVolume();
            this.audio.playMusic('music-menu', true);
        }
    }

    runFirstRun() {
        this.calibration.open({
            auto: true,
            onDone: () => this.startTutorial(),
        });
    }

    startTutorial() {
        this.calibration.cancel();
        return this.showPlay('tutorial', 'tutorial');
    }

    /** @param {'completed'|'skipped'} how */
    completeOnboarding(how) {
        markOnboardingDone(this.storage, how);
    }

    /** Skip button: sets the first-run flag and returns to the menu. */
    skipTutorial() {
        this.play?.tutorialProgress?.skip();
        this.completeOnboarding('skipped');
        this.camera?.unlock();
        this.showMenu();
    }

    /** The in-game pointer-lock prompt: shown while a live run has no mouse capture. */
    updateLockPrompt() {
        if (!this.lockPrompt) {
            return;
        }
        const play = this.play;
        const need = lockPromptNeeded(play, this.camera.locked);
        if (this.lockPrompt.hidden === need) {
            this.lockPrompt.hidden = !need;
        }
    }

    // ---------------------------------------------------------- screens ----

    /** @param {{enter:Function, exit:Function, update:Function}} screen */
    async switchTo(screen) {
        const id = ++this.switchId;
        this.switching = true;
        if (this.current) {
            this.current.exit();
        }
        this.current = screen;
        try {
            await screen.enter();
        } finally {
            // A newer switch may have started while this screen was loading;
            // that one decides when updates resume.
            if (id === this.switchId) {
                this.switching = false;
            }
        }
    }

    async showMenu() {
        await this.switchTo(new MenuScreen(this));
        this.playMenuMusicWhenReady();
    }

    /** @param {string} chartId @param {string} [mode] campaign | quickPlay | daily | ranked */
    async showPlay(chartId, mode, extra = {}) {
        await this.ready3d;
        return this.switchTo(new this.PlayScreen(this, chartId, { mode, ...extra }));
    }

    /** Atlas screenshot hook: the first-run calibration screen, nothing saved. */
    showAtlasCalibration() {
        this.calibration.open({ auto: true });
    }

    /** Atlas screenshot hook: the settings panel (with rebinding) over the menu. */
    async showAtlasSettings() {
        await this.showMenu();
        this.mainMenu.openPanel('settings');
    }

    /** Atlas screenshot hook: a play screen on a frozen, caller-driven clock. No audio, no results. */
    async switchToAtlasPlay(chartId, clock) {
        await this.ready3d;
        return this.switchTo(new this.PlayScreen(this, chartId, { mode: 'quickPlay', atlas: clock }));
    }

    /** Atlas screenshot hook: a practice play screen on a caller-driven clock (loop set, no audio, nothing saved). */
    async switchToAtlasPractice(chartId, clock, section) {
        await this.ready3d;
        return this.switchTo(new this.PlayScreen(this, chartId, { mode: 'practice', atlas: clock, atlasPractice: true, section }));
    }

    /** @param {string} chartId @param {object} log a RunRecorder log */
    async showReplay(chartId, log) {
        await this.ready3d;
        return this.switchTo(new this.PlayScreen(this, chartId, { replay: log }));
    }

    /**
     * @param {object} record @param {string} chartId @param {object} log
     * @param {{replay?: boolean}} [options]
     */
    async showResults(record, chartId, log, options) {
        await this.ready3d;
        return this.switchTo(new this.ResultScreen(this, record, chartId, log, options));
    }

    /**
     * Called by a screen that could not start (a track that would not load):
     * says why and returns to the menu.
     * @param {string} message
     */
    failStart(message) {
        toast.error(message);
        window.setTimeout(() => this.showMenu(), 0);
    }

    /** @returns {object|null} the play screen, when one is active. */
    get play() {
        return this.PlayScreen && this.current instanceof this.PlayScreen ? this.current : null;
    }

    // --------------------------------------------------------- controls ----

    bindControls() {
        // Mouse buttons are read on the window, not the canvas: under pointer
        // lock the browser already routes every button to the locked element,
        // and listening higher up means a stray overlay or focus change can
        // never swallow a shot.  Either main button fires, so a swapped-button
        // (left-handed) mouse works without a setting.
        window.addEventListener('mousedown', (event) => {
            const play = this.play;
            if (!play) {
                return;
            }
            const onStage = this.stage.contains(event.target);
            if (play.paused) {
                // A click on the arena resumes; the pause menu's own buttons
                // must not, or "quit" would un-pause instead of quitting.
                if (onStage && !this.pauseOverlay.contains(event.target)) {
                    play.resume();
                }
                return;
            }
            if (this.camera?.locked) {
                if (event.button === 0 || event.button === 2) {
                    event.preventDefault();
                    play.fire(undefined, event.timeStamp);
                }
            } else if (onStage && event.button === 0) {
                this.camera?.lock();
            }
        });
        this.stage.addEventListener('contextmenu', (event) => event.preventDefault());

        this.input.onPress((code, event) => {
            if (Input.isTyping(event)) {
                return;
            }
            const play = this.play;
            // A replay is watched, not played: Space, Esc and P pause it,
            // the up and down arrows change its speed.
            if (play && play.replay) {
                if (code === 'Space' || code === 'Escape' || code === 'KeyP') {
                    play.togglePause();
                    return;
                }
                if (code === 'ArrowUp' || code === 'ArrowDown') {
                    play.changeReplaySpeed(code === 'ArrowUp' ? 1 : -1);
                    return;
                }
            }
            if (code === this.settings.get('bindings').fire && play && !play.paused) {
                play.fire(undefined, event.timeStamp);
            } else if (play && play.practice && !play.paused && practiceKeyFree(code, this.settings.get('bindings'))) {
                event.preventDefault(); // Enter must not also click a focused button
                play.practiceKey(code);
            } else if (code === 'KeyR' && play) {
                play.restart();
            } else if (code === 'KeyQ' && play && play.paused) {
                play.quit();
            } else if (code === 'KeyF') {
                this.toggleFullscreen();
            } else if (code === 'KeyT' && this.current instanceof MenuScreen) {
                this.current.tryStart('tutorial');
            } else if (code === 'KeyQ' && play && play.replay) {
                play.quit();
            } else if (code === 'KeyP' && play && !play.paused) {
                this.camera?.unlock();
                play.pause();
            }
        });

        for (const button of this.pauseOverlay.querySelectorAll('[data-action]')) {
            button.addEventListener('click', () => {
                const play = this.play;
                if (!play) {
                    return;
                }
                const action = button.dataset.action;
                if (action === 'resume') {
                    play.resume();
                } else if (action === 'restart') {
                    play.restart();
                } else if (action === 'quit') {
                    play.quit();
                }
            });
        }

        for (const button of this.resultOverlay.querySelectorAll('[data-action]')) {
            button.addEventListener('click', () => {
                const screen = this.current;
                if (!(this.ResultScreen && screen instanceof this.ResultScreen)) {
                    return;
                }
                const action = button.dataset.action;
                if (action === 'retry') {
                    screen.retry();
                } else if (action === 'next') {
                    screen.next();
                } else if (action === 'menu') {
                    screen.menu();
                }
            });
        }

        const fullscreenButton = document.getElementById('fullscreenBtn');
        if (fullscreenButton) {
            fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
        }
        document.addEventListener('fullscreenchange', () => {
            window.setTimeout(() => this.engine?.resize(), 50);
        });
    }

    enterFullscreen() {
        requestFullscreenFromGesture(this.stage, document);
    }

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (this.stage.requestFullscreen) {
            this.stage.requestFullscreen();
        }
    }
}
