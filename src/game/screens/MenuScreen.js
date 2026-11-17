/**
 * MenuScreen.js
 *
 * Song select, the daily challenge, the player's own songs and settings,
 * drawn as an HTML overlay above a slowly drifting view of an arena.
 *
 * Every official track offers four difficulties.  Tracks open on star totals
 * (RULES.starGates, see progress/unlocks.js); once a track is open all of its
 * difficulties are playable. Clearing a chart on Easy, Normal or Hard earns up
 * to three stars; Expert earns none.
 */
import {
    TRACKS, DIFFICULTIES, ARENAS, resolveChart, dailyChartId, dailyDate,
    buildCustomChart,
} from '../rules/charts.js';
import { themeProvider, trackProvider } from '../providers/index.js';
import { el } from '../../ui/format.js';
import { accountStatus, isDesktop } from '../../platform/platform.js';
import { CUSTOM_LABEL, CUSTOM_NOTE } from '../../ui/CustomSongs.js';
import { STAR_DIFFICULTIES, STARS_PER_CHART, CAMPAIGN_TRACK_IDS } from '../progress/stars.js';
import { chartPlayable } from '../modes/practice.js';
import { trackStates } from '../progress/unlocks.js';

const CAMPAIGN_STAR_TOTAL = CAMPAIGN_TRACK_IDS.length * STAR_DIFFICULTIES.length * STARS_PER_CHART;

export class MenuScreen {
    /** @param {import('../GameApp.js').GameApp} app */
    constructor(app) {
        this.app = app;
        this.overlay = app.menuOverlay;
        this.unsubscribe = [];
        this.libraryBound = false;
    }

    async enter() {
        const daily = resolveChart(dailyChartId());
        this.exited = false;
        this.showcase = null;
        // The 3D backdrop appears once the engine has loaded; the menu itself does not wait for it.
        const backdrop = daily ?? resolveChart('t:range:normal');
        this.app.ready3d?.then(() => {
            if (!this.exited) {
                this.showcase = new this.app.Showcase(this.app.scene, this.app.camera, backdrop);
            }
        }, () => {});

        this.app.mainMenu?.showRoot();
        this.renderHeader();
        this.renderDaily(daily);
        this.renderTracks();
        this.bindLibrary();
        this.renderLibrary();
        this.overlay.hidden = false;
        if (typeof performance !== 'undefined' && performance.mark) {
            performance.mark('cb-menu-ready');
        }

        this.countdown = window.setInterval(() => this.renderDailyClock(), 30000);

        // Menu music needs an unlocked context, which the first click gives.
        if (this.app.audio.ready && this.app.audio.context.state === 'running') {
            this.app.audio.resetMusicVolume();
            this.app.audio.playMusic('music-menu', true);
        } else {
            const start = async () => {
                await this.app.audio.unlock();
                if (!this.app.audio.musicKey && this.app.current === this) {
                    this.app.audio.resetMusicVolume();
                    this.app.audio.playMusic('music-menu', true);
                }
            };
            window.addEventListener('pointerdown', start, { once: true });
            this.unsubscribe.push(() => window.removeEventListener('pointerdown', start));
        }
    }

    exit() {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe = [];
        window.clearInterval(this.countdown);
        this.overlay.hidden = true;
        this.exited = true;
        this.showcase?.dispose();
        this.showcase = null;
        this.app.audio.stopMusic();
    }

    /** @param {number} dt */
    update(dt) {
        this.showcase?.update(dt);
    }

    // ----------------------------------------------------------- header ----

    renderHeader() {
        const name = this.app.services.getPlayerName();
        const logged = this.app.services.isLoggedIn();
        const status = this.overlay.querySelector('#menuStatus');
        const account = accountStatus({ logged, name, desktop: isDesktop() });
        status.textContent = account.text;
        status.className = `menu__status ${account.ok ? 'menu__status--ok' : 'menu__status--warn'}`;
        const stars = this.overlay.querySelector('#menuStars');
        if (stars) {
            stars.textContent = `★ ${this.app.services.progress.total} / ${CAMPAIGN_STAR_TOTAL} stars`;
        }
    }

    // ------------------------------------------------------------ daily ----

    /** @param {object|undefined} chart */
    renderDaily(chart) {
        const host = this.overlay.querySelector('#dailyCard');
        host.replaceChildren();
        if (!chart) {
            return;
        }
        this.daily = chart;
        const best = this.app.services.getPersonalBest(chart.chartId);
        const card = el('button', 'daily__card');
        card.type = 'button';
        const art = document.createElement('img');
        art.className = 'daily__thumb';
        art.src = themeProvider.resolveArena(chart.arena).thumb;
        art.alt = '';
        const body = el('span', 'daily__body');
        body.append(
            el('span', 'daily__key', `DAILY CHALLENGE · ${chart.date}`),
            el('span', 'daily__name', `${chart.trackName} · ${chart.difficulty.name}`),
            el('span', 'daily__meta', `${chart.bpm} BPM  •  ${chart.lanes} windows  •  one chart for everyone, its own leaderboard`),
            el('span', 'daily__foot', best ? `Your best today: ${best.toLocaleString('en-GB')}` : 'Not played yet today'),
        );
        const clock = el('span', 'daily__clock mono', '');
        clock.id = 'dailyClock';
        card.append(art, body, clock);
        card.addEventListener('click', () => this.start(chart.chartId));
        host.append(card);
        this.renderDailyClock();
    }

    renderDailyClock() {
        const clock = this.overlay.querySelector('#dailyClock');
        if (!clock || !this.daily) {
            return;
        }
        if (this.daily.date !== dailyDate()) {
            // Midnight passed while the menu was open.
            this.renderDaily(resolveChart(dailyChartId()));
            return;
        }
        const now = new Date();
        const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
        const left = Math.max(0, reset - now.getTime());
        const hours = Math.floor(left / 3600000);
        const minutes = Math.floor((left % 3600000) / 60000);
        clock.textContent = `resets in ${hours}h ${String(minutes).padStart(2, '0')}m`;
    }

    // ----------------------------------------------------------- tracks ----

    renderTracks() {
        const host = this.overlay.querySelector('#trackList');
        host.replaceChildren();

        const tutorial = resolveChart('tutorial');
        host.append(this.trackCard({
            key: 'T', name: 'Tutorial', mood: 'Learn the counter-strafe (cannot be failed, not ranked)',
            bpm: tutorial.bpm, thumb: themeProvider.theme('range').thumb,
        }, [{ label: 'Start', chart: tutorial, unlocked: true, best: 0, passed: false }]));

        const progress = this.app.services.progress;
        const states = trackStates(TRACKS.map((t) => t.id), progress.total);
        for (const track of TRACKS) {
            const state = states[track.id];
            const options = DIFFICULTIES.map((difficulty) => {
                const chart = resolveChart(`t:${track.id}:${difficulty.id}`);
                return {
                    label: difficulty.name,
                    chart,
                    unlocked: chartPlayable(this.app.playMode, state.unlocked),
                    best: this.app.services.getPersonalBest(chart.chartId),
                    passed: this.app.services.hasPassed(chart.chartId),
                    lockNote: `Earn ${state.gate} stars to open this track (you have ${progress.total})`,
                    stars: STAR_DIFFICULTIES.includes(difficulty.id) ? progress.starsFor(track.id, difficulty.id) : null,
                };
            });
            host.append(this.trackCard({
                key: `${track.bpm} BPM`, name: track.name, mood: track.mood, bpm: track.bpm,
                thumb: themeProvider.theme(ARENAS[track.arena].theme).thumb, trackId: track.id,
            }, options));
        }
    }

    /**
     * @param {{key:string, name:string, mood:string, bpm:number, thumb:string, trackId?:string}} info
     * @param {Array<{label:string, chart:object, unlocked:boolean, best:number, passed:boolean, lockNote?:string, stars?:boolean[]|null}>} options
     */
    trackCard(info, options) {
        const card = el('div', 'track');
        const thumb = document.createElement('img');
        thumb.className = 'track__thumb';
        thumb.src = info.thumb;
        thumb.alt = '';
        const head = el('div', 'track__head');
        head.append(
            el('span', 'track__key', info.key),
            el('span', 'track__name', info.name),
            el('span', 'track__mood', info.mood),
            ...(info.trackId && trackProvider.isPlaceholder(info.trackId)
                ? [el('span', 'track__placeholder', 'Placeholder music')]
                : []),
        );
        const row = el('div', 'track__difficulties');
        for (const option of options) {
            const button = el('button', `diff diff--${option.chart.difficulty.id}${option.unlocked ? '' : ' is-locked'}${option.passed ? ' is-passed' : ''}`);
            button.type = 'button';
            button.disabled = !option.unlocked;
            button.title = option.unlocked
                ? `${option.chart.name}: ${option.chart.lanes} windows, ±${Math.round(option.chart.timing.perfect * 1000)} ms perfect window`
                : option.lockNote;
            button.append(
                el('span', 'diff__label', option.label),
                el('span', 'diff__best mono', option.unlocked
                    ? (option.best ? option.best.toLocaleString('en-GB') : '-')
                    : 'locked'),
                ...(option.unlocked && option.stars
                    ? [el('span', 'diff__stars', option.stars.slice(0, STARS_PER_CHART).map((on) => (on ? '★' : '☆')).join(''))]
                    : []),
            );
            button.addEventListener('click', () => this.start(option.chart.chartId));
            if (info.trackId) {
                button.addEventListener('pointerenter', () => {
                    // Warm the music cache while the player reads the card.
                    this.app.audio.ensure(`music-${info.trackId}`, trackProvider.musicUrls(info.trackId));
                }, { once: true });
            }
            row.append(button);
        }
        card.append(thumb, head, row);
        return card;
    }

    // ---------------------------------------------------------- library ----

    bindLibrary() {
        if (this.libraryBound) {
            return;
        }
        this.libraryBound = true;
        const input = this.overlay.querySelector('#songFile');
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) {
                return;
            }
            await this.addSong(file);
        });
    }

    /** @param {string} text @param {'info'|'error'|''} tone */
    setLibraryStatus(text, tone = '') {
        const status = this.overlay.querySelector('#libraryStatus');
        status.hidden = !text;
        status.textContent = text;
        status.className = `library__status${tone ? ` library__status--${tone}` : ''}`;
    }

    /** @param {File} file */
    async addSong(file) {
        const library = this.app.library;
        if (!library) {
            this.setLibraryStatus('This browser cannot store songs (IndexedDB is unavailable).', 'error');
            return;
        }
        try {
            await this.app.audio.unlock();
            const song = await library.add(file, (stage) => this.setLibraryStatus(`${file.name}: ${stage}`, 'info'));
            const confidence = song.confidence >= 0.5 ? 'confident' : 'unsure: check the tempo, use ½× / 2× if it feels off';
            this.setLibraryStatus(`Added "${song.name}": ${song.bpm} BPM, first beat at ${song.gridOffset.toFixed(2)} s (${confidence}).`, 'info');
            await this.renderLibrary();
        } catch (error) {
            this.setLibraryStatus(error instanceof Error ? error.message : String(error), 'error');
        }
    }

    async renderLibrary() {
        const host = this.overlay.querySelector('#songList');
        host.replaceChildren();
        const library = this.app.library;
        if (!library) {
            return;
        }
        let songs = [];
        try {
            songs = await library.list();
        } catch (error) {
            console.warn(error);
            return;
        }
        if (songs.length === 0) {
            host.append(el('p', 'song-list__empty', 'No songs yet. Add an MP3, OGG, WAV or FLAC and it will appear here with a chart at every difficulty.'));
            return;
        }
        host.append(el('p', 'song-list__note', CUSTOM_NOTE));
        for (const song of songs) {
            host.append(this.songCard(song));
        }
    }

    /** @param {import('../library/SongLibrary.js').Song} song */
    songCard(song) {
        const card = el('div', 'song');
        const head = el('div', 'song__head');
        const minutes = Math.floor(song.duration / 60);
        const seconds = String(Math.round(song.duration % 60)).padStart(2, '0');
        head.append(
            el('span', 'song__name', song.name),
            el('span', 'beta-tag', CUSTOM_LABEL),
            el('span', 'song__meta mono', `${song.bpm} BPM  •  ${minutes}:${seconds}  •  first beat ${song.gridOffset.toFixed(2)} s`),
        );

        const tools = el('div', 'song__tools');
        const half = el('button', 'btn btn--ghost btn--small', '½× tempo');
        half.type = 'button';
        half.addEventListener('click', () => this.retime(song, song.bpm / 2, song.gridOffset));
        const twice = el('button', 'btn btn--ghost btn--small', '2× tempo');
        twice.type = 'button';
        twice.addEventListener('click', () => this.retime(song, song.bpm * 2, song.gridOffset));
        const earlier = el('button', 'btn btn--ghost btn--small', 'beat −20 ms');
        earlier.type = 'button';
        earlier.addEventListener('click', () => this.retime(song, song.bpm, song.gridOffset - 0.02));
        const later = el('button', 'btn btn--ghost btn--small', 'beat +20 ms');
        later.type = 'button';
        later.addEventListener('click', () => this.retime(song, song.bpm, song.gridOffset + 0.02));
        const remove = el('button', 'btn btn--ghost btn--small song__remove', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
            await this.app.library.remove(song.id);
            this.renderLibrary();
        });
        tools.append(half, twice, earlier, later, remove);

        const row = el('div', 'track__difficulties');
        for (const difficulty of DIFFICULTIES) {
            const chart = buildCustomChart(song, difficulty.id);
            const best = this.app.services.getPersonalBest(chart.chartId);
            const button = el('button', `diff diff--${difficulty.id}`);
            button.type = 'button';
            button.append(
                el('span', 'diff__label', difficulty.name),
                el('span', 'diff__best mono', best ? best.toLocaleString('en-GB') : '-'),
            );
            button.addEventListener('click', () => this.startCustom(song, difficulty.id));
            row.append(button);
        }
        card.append(head, tools, row);
        return card;
    }

    /**
     * @param {import('../library/SongLibrary.js').Song} song
     * @param {number} bpm
     * @param {number} gridOffset
     */
    async retime(song, bpm, gridOffset) {
        try {
            await this.app.library.update(song.id, { bpm: Math.round(bpm * 100) / 100, gridOffset: Math.round(gridOffset * 1000) / 1000 });
            await this.renderLibrary();
        } catch (error) {
            this.setLibraryStatus(error instanceof Error ? error.message : String(error), 'error');
        }
    }

    /**
     * @param {import('../library/SongLibrary.js').Song} song
     * @param {string} difficultyId
     */
    async startCustom(song, difficultyId) {
        this.setLibraryStatus(`Loading "${song.name}"…`, 'info');
        try {
            await this.app.audio.unlock();
            await this.app.library.load(song);
        } catch (error) {
            this.setLibraryStatus('That song could not be decoded any more; remove it and add it again.', 'error');
            return;
        }
        const chart = buildCustomChart(song, difficultyId);
        this.setLibraryStatus('');
        this.start(chart.chartId);
    }

    // ------------------------------------------------------------ start ----

    /** @param {string} chartId */
    start(chartId) {
        const chart = resolveChart(chartId);
        if (!chart) {
            this.app.audio.play('sfx-miss', { volume: 0.4 });
            return;
        }
        this.app.audio.play('sfx-ui', { volume: 0.5 });
        // The mode comes from the main menu entry (Campaign / Quick Play / Practice); the daily is its own mode.
        this.app.showPlay(chartId, chart.kind === 'daily' ? 'daily' : (this.app.playMode ?? 'quickPlay'));
    }

    /** Keyboard shortcut target: the tutorial. */
    tryStart(chartId) {
        this.start(chartId);
    }
}
