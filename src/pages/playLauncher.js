/**
 * playLauncher.js - Play on the web pages opens the game fullscreen.
 *
 * Browsers leave fullscreen whenever the document navigates, so a plain link to
 * game.html can never arrive fullscreen.  Instead the Play click embeds the game
 * (same origin, ?embed=1) in a full-viewport frame on the SAME document and
 * requests fullscreen on that frame inside the original click gesture.
 */

/**
 * Whether a click on a Play link should launch the embedded game rather than
 * follow the link (new-tab / modified clicks keep their normal meaning).
 * @param {{button?:number, metaKey?:boolean, ctrlKey?:boolean, shiftKey?:boolean, altKey?:boolean, defaultPrevented?:boolean}} event
 * @param {boolean} canFullscreen
 */
export function shouldLaunchEmbedded(event, canFullscreen) {
    if (!canFullscreen || event.defaultPrevented) {
        return false;
    }
    return (event.button ?? 0) === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** @param {string} href the game page URL @returns {string} */
export function embedUrl(href) {
    const url = new URL(href, 'http://local.invalid/');
    url.searchParams.set('embed', '1');
    return `${url.pathname.replace(/^\//, '')}${url.search}`;
}

/**
 * Whether leaving fullscreen (Esc, F11, browser UI) should tear down the embedded
 * frame. It never does: the frame keeps filling the window so a live run survives.
 * @param {boolean} wasFullscreen the frame had entered fullscreen
 * @param {boolean} isFullscreen  something is fullscreen now
 */
export function shouldCloseOnFullscreenChange(wasFullscreen, isFullscreen) {
    // Never: Esc (or the browser) dropping fullscreen must not tear down a live run. The frame
    // still fills the window and the in-game exit (counterbeat-exit message) is the only way out.
    void wasFullscreen; void isFullscreen;
    return false;
}

/** Leaves the embedded game and returns to the page underneath. */
function closeFrame(frame) {
    if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
    }
    frame.remove();
}

/** @param {Document} doc binds every link to game.html (not a replay link) */
export function bindPlayLinks(doc = document) {
    const links = doc.querySelectorAll('a[href="game.html"]');
    for (const link of links) {
        link.addEventListener('click', (event) => {
            if (!shouldLaunchEmbedded(event, typeof document.documentElement.requestFullscreen === 'function')) {
                return;
            }
            event.preventDefault();
            const frame = document.createElement('iframe');
            frame.className = 'play-frame';
            frame.title = 'CounterBeat';
            frame.setAttribute('allow', 'fullscreen; autoplay; pointer-lock');
            frame.src = embedUrl(link.getAttribute('href'));
            document.body.append(frame);
            // Inside the click gesture: this is what makes the launch fullscreen.
            let entered = false;
            const onChange = () => {
                const now = Boolean(document.fullscreenElement);
                if (shouldCloseOnFullscreenChange(entered, now)) {
                    document.removeEventListener('fullscreenchange', onChange);
                    closeFrame(frame); // unreachable today; kept so a future rule can opt back in
                }
                entered = entered || now;
            };
            document.addEventListener('fullscreenchange', onChange);
            frame.requestFullscreen?.().catch(() => { /* refused: the frame still fills the window; Website button exits */ });
            frame.focus();
        });
    }
    window.addEventListener('message', (event) => {
        if (event.origin === window.location.origin && event.data?.type === 'counterbeat-exit') {
            const frame = document.querySelector('.play-frame');
            if (frame) {
                closeFrame(frame);
            }
        }
    });
}
