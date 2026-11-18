/** Browser wiring: loads the JSON manifests (bundled by Vite) into the providers. */
import tracksManifest from '../../../data/tracks.json';
import themesManifest from '../../../data/themes.json';
import targetsManifest from '../../../data/targets.json';
import crosshairsManifest from '../../../data/crosshairs.json';
import { AssetProvider } from './AssetProvider.js';
import { TrackProvider } from './TrackProvider.js';
import { ThemeProvider } from './ThemeProvider.js';
import { FeedbackBus } from './FeedbackBus.js';
import { buildCatalogue } from '../progress/shopCatalog.js';
import { RULES } from '../rules/rules.js';

export const assets = new AssetProvider(targetsManifest, tracksManifest);
export const trackProvider = new TrackProvider(tracksManifest);
export const themeProvider = new ThemeProvider(themesManifest, targetsManifest, crosshairsManifest);
/** Every Shop item (bots, skins, crosshairs, themes) with its coin price. */
export const shopCatalogue = buildCatalogue({ targets: targetsManifest, crosshairs: crosshairsManifest, themes: themesManifest }, RULES.economy);
export const feedbackBus = new FeedbackBus();
export { AssetProvider, TrackProvider, ThemeProvider, FeedbackBus };
