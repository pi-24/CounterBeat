/** Set (or clear, when null) the root look; every screen switch resets it so no look leaks. */
export function applyLook(look, root = typeof document !== 'undefined' ? document.documentElement : null) {
    if (!root) return;
    if (look) root.dataset.look = look;
    else delete root.dataset.look;
}
