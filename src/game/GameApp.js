/**
 * GameApp.js
 *
 * Boots the 3D engine, loads the audio, and switches between the three
 * screens.  The page passes in a `services` object, which is the only
 * channel between the game and the rest of the website: the screens ask it
 * who is playing and hand it finished runs, and it is the page's job to put
 * those in local storage.
 */
import { requestFullscreenFromGesture, lockPromptNeeded } from './onboarding/startFlow.js';
import { Engine, Scene } from './engine.js';
import { FpsCamera } from './fps/FpsCamera.js';
import { Hud } from './fps/Hud.js';
import { Input } from './Input.js';
import { audio as sharedAudio } from './audio/AudioEngine.js';
import { settings as sharedSettings } from './Settings.js';
import { MenuScreen } from './screens/MenuScreen.js';
import { PlayScreen } from './screens/PlayScreen.js';
import { ResultScreen } from './screens/ResultScreen.js';
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
     * @param {(done:number,total:number) => void} [options.onProgress]
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
        this.onProgress = options.onProgress ?? (() => {});
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
            onMode: (mode) => { this.playMode = mode; },
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

    async boot() {
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

        this.settingsPanel.init();
        this.mainMenu.mount();
        this.bindControls();

        await this.audio.load(assets.audioManifest(), this.onProgress);

        this.engine.runRenderLoop(() => {
            const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
            if (this.current && !this.switching) {
                this.current.update(dt);
            }
            this.updateLockPrompt();
            this.scene.render();
        });
        window.addEventListener('resize', () => this.engine.resize());

        this.loadingOverlay.hidden = true;
        this.bindStart();
        if (this.pendingReplay) {
            const { chartId, log } = this.pendingReplay;
            this.pendingReplay = null;
            await this.showReplay(chartId, log);
            return;
        }
        await this.showMenu();
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
        button.addEventListener('click', async () => {
            if (busy) {
                return;
            }
            busy = true;
            // Fullscreen must be requested synchronously inside this click.
            this.enterFullscreen();
            try {
                await this.audio.unlock();
            } catch {
                // No audio is not a reason to trap the player on the splash.
            }
            this.startOverlay.hidden = true;
            if (shouldAutoStart(this.storage)) {
                this.runFirstRun();
            } else if (this.current instanceof MenuScreen) {
                this.audio.resetMusicVolume();
                this.audio.playMusic('music-menu', true);
            }
        });
        button.focus();
    }

    /** First launch: short calibration (skippable), then the tutorial (skippable). */
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
        this.camera.unlock();
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

    showMenu() {
        return this.switchTo(new MenuScreen(this));
    }

    /** @param {string} chartId @param {string} [mode] campaign | quickPlay | daily | ranked */
    showPlay(chartId, mode, extra = {}) {
        return this.switchTo(new PlayScreen(this, chartId, { mode, ...extra }));
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
    switchToAtlasPlay(chartId, clock) {
        return this.switchTo(new PlayScreen(this, chartId, { mode: 'quickPlay', atlas: clock }));
    }

    /** @param {string} chartId @param {object} log a RunRecorder log */
    showReplay(chartId, log) {
        return this.switchTo(new PlayScreen(this, chartId, { replay: log }));
    }

    /**
     * @param {object} record @param {string} chartId @param {object} log
     * @param {{replay?: boolean}} [options]
     */
    showResults(record, chartId, log, options) {
        return this.switchTo(new ResultScreen(this, record, chartId, log, options));
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

    /** @returns {PlayScreen|null} the play screen, when one is active. */
    get play() {
        return this.current instanceof PlayScreen ? this.current : null;
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
            if (this.camera.locked) {
                if (event.button === 0 || event.button === 2) {
                    event.preventDefault();
                    play.fire(undefined, event.timeStamp);
                }
            } else if (onStage && event.button === 0) {
                this.camera.lock();
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
                this.camera.unlock();
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
                if (!(screen instanceof ResultScreen)) {
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
            window.setTimeout(() => this.engine.resize(), 50);
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
