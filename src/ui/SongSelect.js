/**
 * SongSelect.js - the song-select panel (Direction C, mockup frame 02): a big
 * geometric cover with PLAY under it, the track's facts, a segmented difficulty
 * bar (Q / E on a keyboard, LB / RB on a pad) and the track list with BPM,
 * length, rank and stars in a fixed mono column.  Focus on a row IS selection,
 * so the pad, keyboard and mouse all move the same cursor.  PLAY is the only
 * filled acid control.
 *
 * The rows are built once; moving the selection only updates text and classes,
 * so focus is never lost.  All data comes in through `source`, which keeps this
 * file free of rules code.
 */
import { el } from './format.js';
import { coverSvg } from './trackCovers.js';
import { starGlyphs, stepIndex, indexCounter } from './songSelectModel.js';

/**
 * @typedef {object} SongCell what is known about one track on one difficulty
 * @property {string} chartId @property {string|null} rank best rank, null when never played
 * @property {number} best best score @property {boolean[]|null} stars null when this difficulty awards none
 * @property {number} bots notes in the chart
 */

/**
 * @typedef {object} SongSource
 * @property {import('./songSelectModel.js').SongRow[]} rows
 * @property {Array<{id:string, name:string}>} difficulties
 * @property {(trackId:string, difficultyId:string) => SongCell} cell
 * @property {(trackId:string) => string} theme arena name for the eyebrow
 * @property {(chartId:string) => void} onPlay
 * @property {(trackId:string) => void} [onSelect] called when the track changes (warm the audio cache)
 */

export class SongSelect {
    /** @param {HTMLElement} host @param {SongSource} source @param {{track:number, difficulty:number}} selection */
    constructor(host, source, selection) {
        this.host = host;
        this.source = source;
        this.track = selection.track;
        this.difficulty = selection.difficulty;
        this.rowEls = [];
        this.segEls = [];
        this.build();
        this.update();
    }

    build() {
        const { source } = this;
        const root = el('div', 'songselect');

        // Left: the cover, its rank badge and PLAY.
        const side = el('div', 'songselect__side');
        const art = el('div', 'songselect__cover');
        this.coverArt = el('div', 'songselect__art');
        this.rankBadge = el('div', 'songselect__rank');
        this.sideLabel = el('div', 'songselect__sidelabel mono');
        art.append(this.coverArt, this.rankBadge, this.sideLabel);
        this.play = el('button', 'playbtn');
        this.play.type = 'button';
        this.play.dataset.menuPlay = 'true';
        this.play.append(el('span', 'playbtn__arrow'), el('span', 'playbtn__label', 'PLAY'));
        this.play.addEventListener('click', () => this.start());
        this.lockNote = el('p', 'songselect__lock');
        side.append(art, this.play, this.lockNote);

        // Right: header, facts, difficulty bar, list.
        const main = el('div', 'songselect__main');
        this.eyebrow = el('p', 'songselect__eyebrow mono');
        const titleRow = el('div', 'songselect__titlerow');
        this.title = el('h3', 'songselect__title');
        this.placeholder = el('span', 'tag songselect__placeholder', 'Placeholder music');
        titleRow.append(this.title, this.placeholder);
        this.mood = el('p', 'songselect__mood');
        this.facts = el('div', 'songselect__facts');
        this.factEls = ['BPM', 'LENGTH', 'BEST SCORE', 'STARS'].map((label) => {
            const cell = el('div', 'songselect__fact');
            const value = el('span', 'songselect__fact-value');
            cell.append(el('span', 'songselect__fact-label', label), value);
            this.facts.append(cell);
            return value;
        });

        const bar = el('div', 'diffbar');
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Difficulty');
        bar.append(this.shoulder('prev', 'Q', 'LB'));
        const segs = el('div', 'diffbar__segs');
        source.difficulties.forEach((difficulty, index) => {
            const seg = el('button', `diffbar__seg diffbar__seg--${difficulty.id}`);
            seg.type = 'button';
            seg.append(el('span', 'diffbar__name', difficulty.name.toUpperCase()), el('span', 'diffbar__meta mono'));
            seg.addEventListener('click', () => this.setDifficulty(index));
            segs.append(seg);
            this.segEls.push(seg);
        });
        bar.append(segs, this.shoulder('next', 'E', 'RB'));

        const list = el('div', 'tracklist');
        list.setAttribute('role', 'list');
        const head = el('div', 'tracklist__head mono');
        for (const text of ['#', '', 'TRACK', 'BPM', 'LEN', 'RANK', 'STARS']) head.append(el('span', '', text));
        list.append(head);
        source.rows.forEach((row, index) => {
            const button = el('button', 'trow');
            button.type = 'button';
            button.dataset.track = row.id;
            const cover = el('span', 'trow__cover');
            cover.innerHTML = coverSvg(row.id);
            const name = el('span', 'trow__name', row.name);
            const rank = el('span', 'trow__rank mono');
            const stars = el('span', 'trow__stars mono');
            button.append(
                el('span', 'trow__idx mono', String(index + 1).padStart(2, '0')), cover, name,
                el('span', 'trow__bpm mono', String(row.bpm)), el('span', 'trow__len mono', row.length), rank, stars,
            );
            button.addEventListener('focus', () => this.setTrack(index));
            button.addEventListener('click', () => this.setTrack(index));
            button.addEventListener('dblclick', () => this.start());
            list.append(button);
            this.rowEls.push({ button, rank, stars, name });
        });

        main.append(this.eyebrow, titleRow, this.mood, this.facts, bar, list);
        root.append(side, main);
        this.host.replaceChildren(root);
    }

    /** The Q / E (LB / RB) end caps: clickable, but never a pad focus stop. */
    shoulder(which, key, pad) {
        const button = el('button', `diffbar__cap diffbar__cap--${which}`);
        button.type = 'button';
        button.tabIndex = -1;
        button.dataset.nofocus = 'true';
        button.setAttribute('aria-label', which === 'prev' ? 'Easier difficulty' : 'Harder difficulty');
        button.dataset[which === 'prev' ? 'shoulderPrev' : 'shoulderNext'] = 'true';
        const keyGlyph = el('span', 'key', key);
        keyGlyph.dataset.device = 'kbm';
        const padGlyph = el('span', 'pad pad--wide', pad);
        padGlyph.dataset.device = 'pad';
        button.append(keyGlyph, padGlyph);
        button.addEventListener('click', () => this.setDifficulty(this.difficulty + (which === 'prev' ? -1 : 1)));
        return button;
    }

    get row() {
        return this.source.rows[this.track];
    }

    get difficultyId() {
        return this.source.difficulties[this.difficulty].id;
    }

    /** @returns {string} the chart the PLAY button starts */
    get chartId() {
        return this.source.cell(this.row.id, this.difficultyId).chartId;
    }

    /** @param {number} index */
    setTrack(index) {
        const next = stepIndex(index, 0, this.source.rows.length);
        if (next === this.track) {
            return;
        }
        this.track = next;
        this.source.onSelect?.(this.row.id);
        this.update();
    }

    /** @param {number} index clamped to the bar */
    setDifficulty(index) {
        const next = stepIndex(index, 0, this.source.difficulties.length);
        if (next !== this.difficulty) {
            this.difficulty = next;
            this.update();
        }
    }

    start() {
        if (this.row.playable) {
            this.source.onPlay(this.chartId);
        } else {
            this.source.onPlay(null); // MenuScreen plays the "locked" cue
        }
    }

    /** Puts focus on the selected row (entering the panel). */
    focusSelected() {
        this.rowEls[this.track]?.button.focus?.({ preventScroll: true });
    }

    /** Refreshes every cell and the detail for the current selection. */
    update() {
        const { source, row } = this;
        const cell = source.cell(row.id, this.difficultyId);
        const total = source.rows.length;
        this.coverArt.innerHTML = coverSvg(row.id);
        this.rankBadge.replaceChildren(el('b', '', cell.rank ?? '-'), el('span', 'mono', 'BEST RANK'));
        this.sideLabel.textContent = `SIDE ${this.track % 2 === 0 ? 'A' : 'B'} - TRACK ${String(this.track + 1).padStart(2, '0')}`;
        this.eyebrow.textContent = `${indexCounter(this.track, total)} - ${source.theme(row.id).toUpperCase()} - ${cell.bots} BOTS ON ${this.difficultyId.toUpperCase()}`;
        this.title.textContent = row.name;
        this.placeholder.hidden = !row.placeholder;
        this.mood.textContent = row.mood;
        const [bpm, length, best, stars] = this.factEls;
        bpm.textContent = String(row.bpm);
        length.textContent = row.length;
        best.textContent = cell.best ? cell.best.toLocaleString('en-GB') : '-';
        stars.textContent = cell.stars ? starGlyphs(cell.stars) : 'NONE';
        this.play.disabled = !row.playable;
        this.lockNote.textContent = row.playable ? '' : row.lockNote;
        this.lockNote.hidden = row.playable;

        source.difficulties.forEach((difficulty, index) => {
            const seg = this.segEls[index];
            const c = source.cell(row.id, difficulty.id);
            seg.classList.toggle('is-selected', index === this.difficulty);
            seg.setAttribute('aria-pressed', String(index === this.difficulty));
            seg.querySelector('.diffbar__meta').textContent = c.stars ? starGlyphs(c.stars) : (c.rank ?? '');
        });
        source.rows.forEach((r, index) => {
            const entry = this.rowEls[index];
            const c = source.cell(r.id, this.difficultyId);
            const selected = index === this.track;
            entry.button.classList.toggle('is-selected', selected);
            entry.button.classList.toggle('is-locked', !r.playable);
            if (selected) {
                entry.button.setAttribute('aria-current', 'true');
            } else {
                entry.button.removeAttribute('aria-current');
            }
            entry.rank.textContent = r.playable ? (c.rank ?? '-') : 'LOCK';
            entry.stars.textContent = !r.playable ? `${r.gate}★` : (c.stars ? starGlyphs(c.stars) : '-');
        });
    }
}
