/**
 * format.js
 *
 * Small presentation helpers shared by the pages that render tables and
 * statistics.  Keeping them here stops the same `toLocaleString` call being
 * rewritten in four different files.
 */

/** @param {number} value */
export function formatScore(value) {
    return Number(value ?? 0).toLocaleString('en-GB');
}

/** @param {number} fraction a value between 0 and 1. */
export function formatAccuracy(fraction) {
    return `${(Number(fraction ?? 0) * 100).toFixed(1)}%`;
}

/** @param {string} isoDate */
export function formatDate(isoDate) {
    if (!isoDate) {
        return '—';
    }
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    return date.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
    });
}

/** @param {string} isoDate */
export function formatRelative(isoDate) {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) {
        return 'just now';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return `${hours} h ago`;
    }
    return formatDate(isoDate);
}

/**
 * Builds a stat tile.
 * @param {string} label
 * @param {string} value
 * @returns {HTMLElement}
 */
export function statTile(label, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'stat';

    const valueNode = document.createElement('div');
    valueNode.className = 'stat__value';
    valueNode.textContent = value;

    const labelNode = document.createElement('div');
    labelNode.className = 'stat__label';
    labelNode.textContent = label;

    wrapper.append(valueNode, labelNode);
    return wrapper;
}

/**
 * Creates an element with a class and text in one call.
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}
