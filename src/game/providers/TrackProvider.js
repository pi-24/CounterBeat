import { indexById } from './AssetProvider.js';

/** Track metadata and music URLs, from data/tracks.json. */
export class TrackProvider {
    constructor(manifest) {
        this.version = manifest.version;
        this.tracks = Object.freeze([...manifest.tracks]);
        this.byId = indexById(this.tracks, 'track');
    }

    /** @param {string} id */
    get(id) { return this.byId.get(id); }

    /** @param {string} id @returns {string[]} candidate URLs, best first */
    musicUrls(id) {
        const track = this.byId.get(id);
        if (!track) throw new Error(`Unknown track "${id}"`);
        return [...track.audio];
    }

    /** @param {string} id */
    isPlaceholder(id) { return !!this.byId.get(id)?.placeholder; }
}
