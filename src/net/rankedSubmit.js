/**
 * Builds the ranked submission body (AC32). In the desktop app the Steam
 * session ticket (hex, from the main process via SteamService) rides along so
 * the edge function can verify identity; it never touches the replay checks.
 * No server credential exists on the client: only the server verifies.
 */

/** @returns {object|null} the desktop bridge, if running in the Electron shell */
export function desktopBridge(g = globalThis) {
    return g.counterbeatDesktop?.platform === 'desktop' ? g.counterbeatDesktop : null;
}

/**
 * @param {object} record
 * @param {object} log
 * @param {string|null} token run token
 * @param {object} [g] global (injectable for tests)
 * @returns {Promise<{ok:true, body:object}|{ok:false, reason:string}>}
 */
export async function buildSubmitBody(record, log, token, g = globalThis) {
    const body = { record, log, token };
    const desktop = desktopBridge(g);
    if (!desktop) return { ok: true, body };
    let ticket = null;
    try { ticket = await desktop.steam?.getAuthTicket?.(); } catch { ticket = null; }
    if (typeof ticket !== 'string' || !ticket) return { ok: false, reason: 'Steam is not running, so this run cannot be ranked' };
    return { ok: true, body: { ...body, desktop: true, steamTicket: ticket } };
}
