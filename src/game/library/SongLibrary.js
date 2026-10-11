/**
 * SongLibrary.js
 *
 * The player's own songs, kept in IndexedDB in this browser: the audio file
 * itself plus what the analyser found (tempo, first beat).  Nothing here is
 * uploaded anywhere - custom songs stay on the machine, and their runs are
 * personal bests only, because the server has no way to check a chart it
 * cannot hear.
 */
import { analyseBeat, hashBytes } from './analyse.js';

const DB_NAME = 'counterbeat-songs';
const STORE = 'songs';
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_SECONDS = 10 * 60;
const MIN_SECONDS = 20;

/**
 * @typedef {object} Song
 * @property {string} id content hash
 * @property {string} name
 * @property {number} size bytes
 * @property {string} type MIME type
 * @property {number} bpm
 * @property {number} gridOffset seconds to the first beat
 * @property {number} duration seconds
 * @property {number} confidence 0..1 from the analyser
 * @property {number} addedAt epoch ms
 * @property {Blob} blob the file
 */

export class SongLibrary {
    /** @param {import('../audio/AudioEngine.js').AudioEngine} audio */
    constructor(audio) {
        this.audio = audio;
        /** @type {Promise<IDBDatabase>|null} */
        this.opening = null;
    }

    /** @returns {boolean} whether this browser can store songs at all. */
    static get available() {
        return typeof indexedDB !== 'undefined';
    }

    /** @returns {Promise<IDBDatabase>} */
    open() {
        if (!this.opening) {
            this.opening = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => {
                    const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt');
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return this.opening;
    }

    /**
     * @param {IDBTransactionMode} mode
     * @param {(store: IDBObjectStore) => IDBRequest} action
     * @returns {Promise<any>}
     */
    async run(mode, action) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const request = action(tx.objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /** @returns {Promise<Song[]>} newest first, without the blobs' bytes read. */
    async list() {
        const songs = await this.run('readonly', (store) => store.getAll());
        return songs.sort((a, b) => b.addedAt - a.addedAt);
    }

    /** @param {string} id @returns {Promise<Song|undefined>} */
    get(id) {
        return this.run('readonly', (store) => store.get(id));
    }

    /** @param {string} id */
    remove(id) {
        return this.run('readwrite', (store) => store.delete(id));
    }

    /**
     * Adds a file: hashes it, decodes it, finds the beat, stores it.
     * @param {File} file
     * @param {(stage: string) => void} [onProgress]
     * @returns {Promise<Song>}
     */
    async add(file, onProgress = () => {}) {
        if (file.size > MAX_BYTES) {
            throw new Error(`That file is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_BYTES / 1048576} MB.`);
        }
        onProgress('Reading file…');
        const bytes = await file.arrayBuffer();
        const id = await hashBytes(bytes);
        const existing = await this.get(id);
        if (existing) {
            return existing;
        }

        onProgress('Decoding audio…');
        let buffer;
        try {
            buffer = await this.audio.decode(bytes);
        } catch (error) {
            throw new Error('That file could not be decoded as audio. MP3, OGG, WAV, FLAC and M4A usually work.');
        }
        if (buffer.duration < MIN_SECONDS) {
            throw new Error('That track is too short to chart (under 20 seconds).');
        }
        if (buffer.duration > MAX_SECONDS) {
            throw new Error('That track is longer than ten minutes; trim it first.');
        }

        onProgress('Finding the beat…');
        await new Promise((resolve) => setTimeout(resolve, 20)); // let the message paint
        const beat = analyseBeat(buffer);

        /** @type {Song} */
        const song = {
            id,
            name: file.name.replace(/\.[^.]+$/, '').slice(0, 60),
            size: file.size,
            type: file.type,
            bpm: beat.bpm,
            gridOffset: beat.gridOffset,
            duration: buffer.duration,
            confidence: beat.confidence,
            addedAt: Date.now(),
            blob: file,
        };
        await this.run('readwrite', (store) => store.put(song));
        this.audio.setBuffer(`custom-${id}`, buffer);
        return song;
    }

    /**
     * Saves a manual correction (the player heard the detector was off).
     * @param {string} id
     * @param {{bpm?:number, gridOffset?:number, name?:string}} changes
     * @returns {Promise<Song>}
     */
    async update(id, changes) {
        const song = await this.get(id);
        if (!song) {
            throw new Error('Song not found');
        }
        const next = { ...song, ...changes };
        if (next.bpm < 40 || next.bpm > 300) {
            throw new Error('Tempo must be between 40 and 300 BPM');
        }
        next.gridOffset = Math.max(0, Math.min(next.duration, next.gridOffset));
        await this.run('readwrite', (store) => store.put(next));
        return next;
    }

    /**
     * Makes the song's audio available to the engine under `custom-<id>`.
     * @param {Song} song
     */
    async load(song) {
        const key = `custom-${song.id}`;
        if (this.audio.has(key)) {
            return key;
        }
        const buffer = await this.audio.decode(await song.blob.arrayBuffer());
        this.audio.setBuffer(key, buffer);
        return key;
    }
}
