/**
 * siteConfig.js
 *
 * Deployment-specific settings.  Everything the coursework requires works
 * with this file untouched: accounts and scores live in local storage.
 *
 * The one optional extra is a shared, cross-browser rankings table for the
 * public deployment.  It is backed by a Firebase Realtime Database reached
 * over plain HTTPS, and is switched off while the URL below is empty.
 *
 * To enable it:
 *   1. console.firebase.google.com → create a project → Build → Realtime
 *      Database → create (any region) → start in *test mode*.
 *   2. Rules tab → allow reads and writes on /scores (test mode already does
 *      for 30 days; for longer, set `".read": true, ".write": true` under
 *      "scores").
 *   3. Paste the database URL below, e.g.
 *      'https://counterbeat-default-rtdb.europe-west1.firebasedatabase.app'
 *
 * Note for the marked submission: the brief awards zero marks for scores
 * kept server-side, so leave this empty in the copy that is handed in.  The
 * local table is the graded one; the global table is an addition on top.
 */
export const SITE_CONFIG = Object.freeze({
    globalScoreboardUrl: 'https://counterbeatdata-default-rtdb.firebaseio.com/',
});
