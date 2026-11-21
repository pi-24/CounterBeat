/**
 * Custom songs (Beta): labelling shown in the menu. Custom songs use
 * constant-tempo analysis and are unranked; the submit gate is in core/customGate.js.
 */
export { canSubmitRanked, isCustomChartId } from '../core/customGate.js';
export const CUSTOM_LABEL = 'Custom (Beta)';
export const CUSTOM_NOTE = 'Beta: constant-tempo analysis only. Custom songs are unranked.';
