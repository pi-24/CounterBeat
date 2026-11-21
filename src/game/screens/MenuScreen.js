/**
 * MenuScreen.js
 *
 * The main menu's data, song select, the player's own songs and settings,
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
import { trackProvider } from '../providers/index.js';
import { el } from '../../ui/format.js';
import { BeatMap } from '../rules/BeatMap.js';
import { SongSelect } from '../../ui/SongSelect.js';
import { buildSongRows, initialSelection } from '../../ui/songSelectModel.js';
import { buildMenuPreview, chipsModel } from '../../ui/menuPreview.js';
import { isDesktop } from '../../platform/platform.js';
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
        this.daily = resolveChart(dailyChartId());
        const daily = this.daily;
        this.exited = false;
        this.showcase = null;
        // The 3D backdrop appears once the engine has loaded; the menu itself does not wait for it.
        const backdrop = daily ?? resolveChart('t:range:normal');
        this.app.ready3d?.then(() => {
            if (!this.exited) {
                this.showcase = new this.app.Showcase(this.app.scene, this.app.camera, backdrop);
            }
        }, () => {});

        this.renderHeader();
        this.renderTracks();
        this.bindLibrary();
        this.renderLibrary();
        this.overlay.hidden = false;
        // While the Play splash is still up it keeps the focus; it hands it over when it closes.
        this.app.mainMenu?.showRoot({ focus: this.app.startOverlay?.hidden !== false });
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

    /** Player / rank / level chips in the top bar. */
    renderHeader() {
        const services = this.app.services;
        const chips = this.overlay.querySelector('#menuChips');
        if (!chips) {
            return;
        }
        const model = chipsModel({
            name: services.getPlayerName(),
            bestRank: services.history?.bestRank() ?? null,
            stars: services.progress.total,
        });
        chips.replaceChildren(...model.map((chip) => {
            const node = el('div', 'chip');
            node.append(el('span', 'chip__label', chip.label), el('span', 'chip__value', chip.value));
            return node;
        }));
    }

    // ---------------------------------------------------------- preview ----

    /** @returns {import('../../ui/menuPreview.js').PreviewContext} real data for the preview panel */
    previewContext() {
        const services = this.app.services;
        const progress = services.progress;
        const history = services.history;
        const ids = TRACKS.map((t) => t.id);
        const states = trackStates(ids, progress.total);
        const open = ids.filter((id) => states[id].unlocked);
        const locked = ids.map((id) => states[id]).find((s) => !s.unlocked);
        const last = history?.last ?? null;
        const chart = this.daily;
        const settings = this.app.settings;
        return {
            stars: progress.total,
            starTotal: CAMPAIGN_STAR_TOTAL,
            tracksOpen: open.length,
            trackCount: ids.length,
            nextGate: locked ? locked.gate : null,
            bestRank: history?.bestRank() ?? null,
            bestAccuracy: history?.bestAccuracy() ?? 0,
            last,
            lastRank: last ? history.bestRankFor(last.chartId) : null,
            daily: chart ? {
                trackId: chart.trackId, trackName: chart.trackName, difficulty: chart.difficulty.name, bpm: chart.bpm,
                best: services.getPersonalBest(chart.chartId), date: chart.date, windows: chart.lanes,
            } : null,
            dailyClock: this.dailyClockText(),
            songs: this.songCount ?? null,
            loggedIn: services.isLoggedIn(),
            desktop: isDesktop(),
            focusTrackId: open.length ? open[open.length - 1] : ids[0],
            settings: {
                sensitivity: settings.get('sensitivity'),
                fov: settings.get('fov'),
                offsetMs: Math.round((settings.get('audioOffset') ?? 0) * 1000),
            },
        };
    }

    /** @param {string} id the focused main-menu entry @returns {import('../../ui/menuPreview.js').PreviewModel} */
    previewFor(id) {
        return buildMenuPreview(id, this.previewContext());
    }

    // ------------------------------------------------------------ daily ----

    /** @returns {string} "RESETS 06:12", the time until the daily changes (UTC midnight) */
    dailyClockText() {
        const now = new Date();
        const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
        const left = Math.max(0, reset - now.getTime());
        const hours = Math.floor(left / 3600000);
        const minutes = Math.floor((left % 3600000) / 60000);
        return `RESETS ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    renderDailyClock() {
        if (this.daily && this.daily.date !== dailyDate()) {
            // Midnight passed while the menu was open.
            this.daily = resolveChart(dailyChartId());
        }
        this.app.mainMenu?.refreshPreview();
    }

    // ----------------------------------------------------------- tracks ----

    /** (Re)builds song select for the current mode. Practice opens every track. */
    renderTracks() {
        const host = this.overlay.querySelector('#songSelect');
        if (!host) {
            return;
        }
        const services = this.app.services;
        const progress = services.progress;
        const states = trackStates(TRACKS.map((t) => t.id), progress.total);
        const rows = buildSongRows(TRACKS, states, {
            playable: (unlocked) => chartPlayable(this.app.playMode, unlocked),
            stars: progress.total,
            placeholder: (id) => trackProvider.isPlaceholder(id),
        });
        const difficultyIds = DIFFICULTIES.map((d) => d.id);
        const selection = initialSelection(rows, difficultyIds, services.history?.last ?? null);
        const bots = new Map();
        this.songSelect = new SongSelect(host, {
            rows,
            difficulties: DIFFICULTIES,
            theme: (trackId) => ARENAS[TRACKS.find((t) => t.id === trackId).arena].theme,
            cell: (trackId, difficultyId) => {
                const chart = resolveChart(`t:${trackId}:${difficultyId}`);
                if (!bots.has(chart.chartId)) {
                    bots.set(chart.chartId, new BeatMap(chart).total);
                }
                return {
                    chartId: chart.chartId,
                    rank: services.history?.bestRankFor(chart.chartId) ?? null,
                    best: services.getPersonalBest(chart.chartId),
                    stars: STAR_DIFFICULTIES.includes(difficultyId) ? progress.starsFor(trackId, difficultyId).slice(0, STARS_PER_CHART) : null,
                    bots: bots.get(chart.chartId),
                };
            },
            onSelect: (trackId) => {
                // Warm the music cache while the player reads the page.
                this.app.audio.ensure(`music-${trackId}`, trackProvider.musicUrls(trackId));
            },
            onPlay: (chartId) => (chartId ? this.start(chartId) : this.app.audio.play('sfx-miss', { volume: 0.4 })),
        }, selection);
    }

    /** Called when the song-select panel opens: the selected row takes focus. */
    focusSongSelect() {
        this.songSelect?.focusSelected();
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
        this.songCount = songs.length;
        this.app.mainMenu?.refreshPreview();
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
