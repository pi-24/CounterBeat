/**
 * Steam session-ticket verification (AC32). Server side only.
 *
 * The desktop client sends a hex auth session ticket; this module asks the
 * Steam Web API (ISteamUserAuth/AuthenticateUserTicket) who it belongs to.
 * The Web API publisher secret is passed in by the edge function from its
 * own environment and never exists in client code. The ticket only
 * authenticates identity: the replay, chart-hash and rules checks never see it.
 */

const STEAM_AUTH_URL = 'https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/';
/** Real tickets are ~234 bytes; accept a sane window. */
export const MIN_TICKET_BYTES = 16;
export const MAX_TICKET_BYTES = 2048;
const STEAMID64_RE = /^7656119\d{10}$/;

/** @returns {string|null} lower-case hex, or null if malformed */
export function normalizeTicketHex(ticket) {
    if (typeof ticket !== 'string') return null;
    const hex = ticket.trim().toLowerCase();
    if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
    const bytes = hex.length / 2;
    return bytes >= MIN_TICKET_BYTES && bytes <= MAX_TICKET_BYTES ? hex : null;
}

/**
 * @param {unknown} ticket hex string from the client
 * @param {{fetchImpl?: typeof fetch, apiKey?: string, appId?: string|number}} deps
 * @returns {Promise<{ok:true, steamId:string}|{ok:false, reason:string}>}
 */
export async function verifySteamTicket(ticket, { fetchImpl = globalThis.fetch, apiKey, appId } = {}) {
    const hex = normalizeTicketHex(ticket);
    if (!hex) return { ok: false, reason: 'malformed Steam ticket' };
    if (!apiKey || !appId) return { ok: false, reason: 'Steam sign-in is not configured on the server' };
    let body;
    try {
        const url = `${STEAM_AUTH_URL}?${new URLSearchParams({ key: String(apiKey), appid: String(appId), ticket: hex })}`;
        const res = await fetchImpl(url);
        if (!res.ok) return { ok: false, reason: 'Steam could not verify the ticket' };
        body = await res.json();
    } catch {
        return { ok: false, reason: 'Steam could not verify the ticket' };
    }
    const params = body?.response?.params;
    if (!params || params.result !== 'OK' || !STEAMID64_RE.test(String(params.steamid))) {
        return { ok: false, reason: 'invalid or expired Steam ticket' };
    }
    if (params.vacbanned === true || params.publisherbanned === true) {
        return { ok: false, reason: 'this Steam account is banned from ranked' };
    }
    // Family sharing: the ticket's owner may differ from the player; ranked is per player (steamid).
    return { ok: true, steamId: String(params.steamid), ownerSteamId: params.ownersteamid ? String(params.ownersteamid) : null };
}

/**
 * Identity step for a submission. Never reads or changes record/log.
 * Desktop submissions must carry a verified ticket; web ones may omit it.
 * @param {{steamTicket?: unknown, desktop?: unknown}} payload
 * @returns {Promise<{ok:true, steamId:string|null}|{ok:false, reason:string}>}
 */
export async function authenticateSteamIdentity(payload, deps) {
    const has = payload?.steamTicket !== undefined && payload?.steamTicket !== null && payload?.steamTicket !== '';
    if (!has) {
        return payload?.desktop === true ? { ok: false, reason: 'Steam ticket required for desktop ranked runs' } : { ok: true, steamId: null };
    }
    const v = await verifySteamTicket(payload.steamTicket, deps);
    return v.ok ? { ok: true, steamId: v.steamId, ownerSteamId: v.ownerSteamId } : v;
}
