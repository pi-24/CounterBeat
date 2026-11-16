/**
 * windowConfig.js - pure BrowserWindow options for the desktop shell (no electron import,
 * so it can be smoke-tested headlessly).
 */
const { join } = require('node:path');

/** One window for the whole session: fullscreen shows no title bar; leaving fullscreen
 *  yields a normal movable/closable window. The menu bar is removed in main. */
function windowOptions({ windowed = false } = {}) {
    return {
        width: 1280,
        height: 720,
        minWidth: 960,
        minHeight: 540,
        fullscreen: !windowed,
        frame: true,
        autoHideMenuBar: true,
        backgroundColor: '#05070f',
        title: 'CounterBeat',
        show: false,
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    };
}

/** Alt+Enter toggles windowed mode. @param {{alt?:boolean,key?:string,type?:string}} input */
function isWindowToggle(input) {
    return input.type === 'keyDown' && Boolean(input.alt) && input.key === 'Enter';
}

const START_PAGE = 'game.html';
const APP_SCHEME = 'app';
const APP_URL = 'app://counterbeat';

module.exports = { windowOptions, isWindowToggle, START_PAGE, APP_SCHEME, APP_URL };
