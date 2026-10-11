/**
 * static-page.js
 *
 * Entry point for the pages that only need the shared navigation behaviour.
 * The page key is read from the file name so one script can serve them all.
 */
import { initNavigation } from '../ui/Navigation.js';

const file = window.location.pathname.split('/').pop() || 'index.html';
initNavigation(file.replace('.html', ''));
