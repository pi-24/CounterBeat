/**
 * streamLoader.js
 *
 * Streams audio over the network instead of preloading everything before the
 * menu appears.  Bytes are read incrementally from the response body (so the
 * loading UI and callers see real progress), and only a small CRITICAL set of
 * sounds blocks start-up; everything else (menu music, remaining effects,
 * level music) streams in the background and plays as soon as it arrives.
 */

/**
 * Reads a URL as a stream, reporting progress per chunk.
 * @param {string} url
 * @param {(received:number, total:number) => void} [onChunk] total is 0 when unknown
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<ArrayBuffer|null>} null when the request failed
 */
export async function streamBytes(url, onChunk, fetchFn = globalThis.fetch.bind(globalThis)) {
    const response = await fetchFn(url);
    if (!response.ok) {
        return null;
    }
    const total = Number(response.headers?.get?.('content-length')) || 0;
    if (!onChunk || !response.body?.getReader) {
        // No progress consumer: the browser's own buffering is cheaper than reassembling chunks.
        const whole = await response.arrayBuffer();
        onChunk?.(whole.byteLength, whole.byteLength);
        return whole;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onChunk?.(received, total);
    }
    const out = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.byteLength;
    }
    return out.buffer;
}

/** Request order: the menu music first (it is heard first), then the rest. */
export function streamPriority(key) {
    return key === 'music-menu' ? 0 : key.startsWith('music') ? 1 : 2;
}

/**
 * Streams every sound in the background; nothing audio blocks start-up (the
 * menu is DOM, and a sound is a no-op until its buffer arrives).
 * @param {import('../game/audio/AudioEngine.js').AudioEngine} audio
 * @param {Record<string,string[]>} manifest
 * @param {(key:string)=>void} [onArrive] called as each sound becomes playable
 * @returns {Promise<{background:Promise<void>}>} `background` settles when everything
 *   has streamed in (it never rejects: a failed sound just stays silent).
 */
export async function loadStreamed(audio, manifest, onArrive) {
    const rest = Object.entries(manifest).sort(([a], [b]) => streamPriority(a) - streamPriority(b));
    const bg = Promise.all(rest.map(async ([key, urls]) => {
        try {
            await audio.ensure(key, urls);
            onArrive?.(key);
        } catch (e) {
            console.warn(`audio "${key}" failed to stream`, e);
        }
    })).then(() => {});
    return { background: bg };
}
