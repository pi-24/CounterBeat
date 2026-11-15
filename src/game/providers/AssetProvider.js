/**
 * AssetProvider.js
 *
 * The one place gameplay code gets an art or audio URL from.  Manifests are
 * plain JSON in /data; swapping an asset is a manifest-only edit.
 */

/** Builds an id -> entry map and rejects duplicates. */
export function indexById(list, what) {
    const map = new Map();
    for (const entry of list) {
        if (map.has(entry.id)) throw new Error(`Duplicate ${what} id "${entry.id}"`);
        map.set(entry.id, entry);
    }
    return map;
}

export class AssetProvider {
    /**
     * @param {{ sparkTexture:string }} targetsManifest
     * @param {{ sfx:Record<string,string[]>, menuMusic:{key:string,audio:string[]} }} tracksManifest
     */
    constructor(targetsManifest, tracksManifest) {
        this.sparkUrl = targetsManifest.sparkTexture;
        this.sfx = tracksManifest.sfx;
        this.menuMusic = tracksManifest.menuMusic;
    }

    /** @returns {string} the shared spark/flash sprite */
    spark() { return this.sparkUrl; }

    /** @returns {Record<string,string[]>} keys -> candidate URLs for AudioEngine.load */
    audioManifest() {
        return { [this.menuMusic.key]: [...this.menuMusic.audio], ...this.sfx };
    }
}
