/**
 * MenuScreen.js
 *
 * Song select, the daily challenge, the player's own songs and settings,
 * drawn as an HTML overlay above a slowly drifting view of an arena.
 *
 * Every official track offers four difficulties.  Easy and Normal are always
 * open; Hard opens once Normal on that track has been cleared, Expert once
 * Hard has - so the ladder means something without walling anyone off from
 * a song they like.
 */
import {
    TRACKS, DIFFICULTIES, ARENAS, resolveChart, dailyChartId, dailyDate, unlockRequirement,
    buildCustomChart, musicUrls,
} from '../rules/charts.js';
import { Showcase } from '../fps/Showcase.js';
import { el } from '../../ui/format.js';

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
        this.showcase = new Showcase(this.app.scene, this.app.camera, daily ?? resolveChart('t:range:normal'));

        this.renderHeader();
        this.renderDaily(daily);
        this.renderTracks();
        this.bindLibrary();
        this.renderLibrary();
        this.overlay.hidden = false;

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
        this.showcase.dispose();
        this.app.audio.stopMusic();
    }

    /** @param {number} dt */
    update(dt) {
        this.showcase.update(dt);
    }

    // ----------------------------------------------------------- header ----

    renderHeader() {
        const name = this.app.services.getPlayerName();
        const logged = this.app.services.isLoggedIn();
        const status = this.overlay.querySelector('#menuStatus');
        status.textContent = logged
            ? `Signed in as ${name} — scores are saved`
            : 'Playing as a guest — log in to save your scores';
        status.className = `menu__status ${logged ? 'menu__status--ok' : 'menu__status--warn'}`;
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
        art.src = chart.arena.thumb;
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
            key: 'T', name: 'Tutorial', mood: 'Learn the counter-strafe — cannot be failed, not ranked',
            bpm: tutorial.bpm, thumb: ARENAS.range.thumb,
        }, [{ label: 'Start', chart: tutorial, unlocked: true, best: 0, passed: false }]));

        for (const track of TRACKS) {
            const options = DIFFICULTIES.map((difficulty) => {
                const chart = resolveChart(`t:${track.id}:${difficulty.id}`);
                const requirement = unlockRequirement(difficulty.id);
                const unlocked = !requirement || this.app.services.hasPassed(`t:${track.id}:${requirement}`);
                return {
                    label: difficulty.name,
                    chart,
                    unlocked,
                    best: this.app.services.getPersonalBest(chart.chartId),
                    passed: this.app.services.hasPassed(chart.chartId),
                    requirement,
                };
            });
            host.append(this.trackCard({
                key: `${track.bpm} BPM`, name: track.name, mood: track.mood, bpm: track.bpm,
                thumb: ARENAS[track.arena].thumb, trackId: track.id,
            }, options));
        }
    }

    /**
     * @param {{key:string, name:string, mood:string, bpm:number, thumb:string, trackId?:string}} info
     * @param {Array<{label:string, chart:object, unlocked:boolean, best:number, passed:boolean, requirement?:string|null}>} options
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
        );
        const row = el('div', 'track__difficulties');
        for (const option of options) {
            const button = el('button', `diff diff--${option.chart.difficulty.id}${option.unlocked ? '' : ' is-locked'}${option.passed ? ' is-passed' : ''}`);
            button.type = 'button';
            button.disabled = !option.unlocked;
            button.title = option.unlocked
                ? `${option.chart.name} — ${option.chart.lanes} windows, ±${Math.round(option.chart.timing.perfect * 1000)} ms perfect window`
                : `Clear ${option.requirement} on this track first`;
            button.append(
                el('span', 'diff__label', option.label),
                el('span', 'diff__best mono', option.unlocked
                    ? (option.best ? option.best.toLocaleString('en-GB') : '—')
                    : 'locked'),
            );
            button.addEventListener('click', () => this.start(option.chart.chartId));
            if (info.trackId) {
                button.addEventListener('pointerenter', () => {
                    // Warm the music cache while the player reads the card.
                    this.app.audio.ensure(`music-${info.trackId}`, musicUrls(info.trackId));
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
            const confidence = song.confidence >= 0.5 ? 'confident' : 'unsure — check the tempo, use ½× / 2× if it feels off';
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
                el('span', 'diff__best mono', best ? best.toLocaleString('en-GB') : '—'),
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
        this.app.showPlay(chartId);
    }

    /** Keyboard shortcut target: the tutorial. */
    tryStart(chartId) {
        this.start(chartId);
    }
}
