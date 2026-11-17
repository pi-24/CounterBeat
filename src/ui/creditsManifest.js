/** The credits list built from the shipped manifests (same data as CREDITS.md). */
import tracks from '../../data/tracks.json';
import themes from '../../data/themes.json';
import targets from '../../data/targets.json';
import crosshairs from '../../data/crosshairs.json';
import art from '../../data/art.json';
import { buildCredits } from './creditsData.js';

export const CREDITS = buildCredits({ tracks, themes, targets, crosshairs, art });
