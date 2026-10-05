/**
 * GameApp.js
 *
 * Boots the 3D engine, loads the audio, and switches between the three
 * screens.  The page passes in a `services` object, which is the only
 * channel between the game and the rest of the website: the screens ask it
 * who is playing and hand it finished runs, and it is the page's job to put
 * those in local storage.
 */
import { FpsCamera } from './fps/FpsCamera.js';
import { Hud } from './fps/Hud.js';
import { Input } from './Input.js';
import { audio as sharedAudio } from './audio/AudioEngine.js';
import { settings as sharedSettings } from './Settings.js';
import { MenuScreen } from './screens/MenuScreen.js';
import { PlayScreen } from './screens/PlayScreen.js';
import { ResultScreen } from './screens/ResultScreen.js';
import { SettingsPanel } from './screens/SettingsPanel.js';

/**
 * @typedef {object} GameServices
 * @property {() => string} getPlayerName
 * @property {() => boolean} isLoggedIn
 * @property {() => number} getUnlockedLevel
 * @property {(levelId:number) => number} getPersonalBest
 * @property {(record:object) => {personalBest:boolean, saved:boolean}} onRunComplete
 * @property {(judgement:object) => void} onJudgement
 */

const AUDIO_MANIFEST = {
    'music-menu': ['audio/music-menu.ogg', 'audio/music-menu.mp3'],
    'music-level1': ['audio/music-level1.ogg', 'audio/music-level1.mp3'],
    'music-level2': ['audio/music-level2.ogg', 'audio/music-level2.mp3'],
    'music-level3': ['audio/music-level3.ogg', 'audio/music-level3.mp3'],
    'sfx-shot': ['audio/sfx-shot.ogg', 'audio/sfx-shot.mp3'],
    'sfx-skid': ['audio/sfx-skid.ogg', 'audio/sfx-skid.mp3'],
    'sfx-perfect': ['audio/sfx-perfect.ogg', 'audio/sfx-perfect.mp3'],
    'sfx-good': ['audio/sfx-good.ogg', 'audio/sfx-good.mp3'],
    'sfx-miss': ['audio/sfx-miss.ogg', 'audio/sfx-miss.mp3'],
    'sfx-ui': ['audio/sfx-ui.ogg', 'audio/sfx-ui.mp3'],
    'sfx-levelup': ['audio/sfx-levelup.ogg', 'audio/sfx-levelup.mp3'],
    'sfx-gameover': ['audio/sfx-gameover.ogg', 'audio/sfx-gameover.mp3'],
};

export class GameApp {
    /**
     * @param {object} options
     * @param {HTMLCanvasElement} options.canvas
     * @param {HTMLElement} options.stage the element that goes fullscreen
     * @param {HTMLElement} options.hudRoot
     * @param {{loading:HTMLElement, menu:HTMLElement, pause:HTMLElement,
     *          result:HTMLElement}} options.overlays
     * @param {HTMLElement} options.settingsForm
     * @param {GameServices} options.services
     * @param {(done:number,total:number) => void} [options.onProgress]
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

        this.audio = sharedAudio;
        this.settings = sharedSettings;
        this.input = new Input();
        this.hud = new Hud(options.hudRoot);
        this.settingsPanel = new SettingsPanel(options.settingsForm, this.settings);

        /** @type {{enter:Function, exit:Function, update:Function}|null} */
        this.current = null;
        this.switching = false;
    }

    async boot() {
        this.engine = new BABYLON.Engine(this.canvas, true, {
            antialias: true,
            adaptToDeviceRatio: true,
            preserveDrawingBuffer: false,
            stencil: false,
        });
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.skipPointerMovePicking = true;
        this.camera = new FpsCamera(this.scene, this.canvas, this.settings);

        this.settingsPanel.init();
        this.bindControls();

        await this.audio.load(AUDIO_MANIFEST, this.onProgress);

        this.engine.runRenderLoop(() => {
            const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
            if (this.current && !this.switching) {
                this.current.update(dt);
            }
            this.scene.render();
        });
        window.addEventListener('resize', () => this.engine.resize());

        this.loadingOverlay.hidden = true;
        await this.showMenu();
    }

    // ---------------------------------------------------------- screens ----

    /** @param {{enter:Function, exit:Function, update:Function}} screen */
    async switchTo(screen) {
        this.switching = true;
        if (this.current) {
            this.current.exit();
        }
        this.current = screen;
        await screen.enter();
        this.switching = false;
    }

    showMenu() {
        return this.switchTo(new MenuScreen(this));
    }

    /** @param {number} levelId */
    showPlay(levelId) {
        return this.switchTo(new PlayScreen(this, levelId));
    }

    /** @param {object} record @param {number} levelId */
    showResults(record, levelId) {
        return this.switchTo(new ResultScreen(this, record, levelId));
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
                if (onStage) {
                    play.resume();
                }
                return;
            }
            if (this.camera.locked) {
                if (event.button === 0 || event.button === 2) {
                    event.preventDefault();
                    play.fire();
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
            if (code === 'Space' && play && !play.paused) {
                play.fire();
            } else if (code === 'KeyR' && play) {
                play.restart();
            } else if (code === 'KeyQ' && play && play.paused) {
                play.quit();
            } else if (code === 'KeyF') {
                this.toggleFullscreen();
            } else if (code === 'KeyT' && this.current instanceof MenuScreen) {
                this.current.tryStart(0);
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

        const tabs = this.menuOverlay.querySelectorAll('.menu__tab');
        for (const tab of tabs) {
            tab.addEventListener('click', () => {
                for (const other of tabs) {
                    const active = other === tab;
                    other.classList.toggle('is-active', active);
                    other.setAttribute('aria-selected', String(active));
                }
                for (const panel of this.menuOverlay.querySelectorAll('.menu__panel')) {
                    panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.tab);
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

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (this.stage.requestFullscreen) {
            this.stage.requestFullscreen();
        }
    }
}
