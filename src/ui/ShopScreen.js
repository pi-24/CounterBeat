/**
 * ShopScreen.js - the Shop (Direction C): category tabs, the items with price and
 * owned / equipped badges, a large live preview of the selected item (an animated
 * bot with idle, hit and death on demand, a crosshair, or an arena theme), Buy
 * (with a confirm when the balance allows, a clear message when it does not) and
 * Equip, and the coin balance always on screen.
 *
 * Mouse, keyboard and pad all work through plain buttons: the global menu
 * navigator (menuFocus.js) moves focus between them, Q / E (LB / RB) step the
 * tabs through the data-shoulder attributes, and Esc / B clicks Close.
 * It is a dialog over the menu, like Credits.
 */
import { el } from './format.js';
import { SHOP_CATEGORIES } from '../game/progress/shopCatalog.js';
import { buildShopView, statusMessage, coinLabel, equipSettingsPatch } from './shopModel.js';
import { botFrame, framePosition, crosshairSvg, themeSwatches } from './shopPreview.js';

const THUMB_SCALE = 0.75;
const PREVIEW_SCALE = 2.4;
const DEATH_HOLD_MS = 1700;

export class ShopScreen {
    /**
     * @param {HTMLElement} parent the overlay to mount in
     * @param {{progress:object, catalogue:object[], settings:{get:Function, update:Function}, clock?:() => number}} deps
     * @param {{onClose?:() => void, onChange?:() => void}} [handlers]
     */
    constructor(parent, deps, handlers = {}) {
        this.progress = deps.progress;
        this.catalogue = deps.catalogue;
        this.settings = deps.settings;
        this.now = deps.clock ?? (() => performance.now());
        this.handlers = handlers;
        this.tab = SHOP_CATEGORIES[0].id;
        this.selectedId = null;
        this.confirming = false;
        this.message = { text: '', tone: '' };
        this.bot = { mode: 'idle', since: this.now() };
        this.sprite = null;
        this.raf = 0;
        this.opener = null;

        this.root = el('div', 'shop');
        this.root.hidden = true;
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-modal', 'true');
        this.root.setAttribute('aria-label', 'Shop');
        this.root.tabIndex = -1;
        this.root.addEventListener('keydown', (e) => this.onKey(e));
        parent.append(this.root);
        this.unsubscribe = this.progress.onChange?.(() => { if (!this.root.hidden) this.render(); });
    }

    /** @param {HTMLElement|null} [opener] element to refocus on close */
    open(opener = null, choice = {}) {
        this.opener = opener;
        this.tab = choice.tab ?? this.tab;
        this.selectedId = choice.selectedId ?? null;
        this.confirming = false;
        this.message = { text: '', tone: '' };
        this.root.hidden = false;
        this.render();
        this.root.querySelector('.shop__item.is-selected')?.focus({ preventScroll: true });
        if (!this.root.contains(document.activeElement)) this.root.focus({ preventScroll: true });
    }

    close() {
        this.root.hidden = true;
        this.stopAnimation();
        this.handlers.onClose?.();
        const back = this.opener;
        this.opener = null;
        if (back && back.isConnected) back.focus();
    }

    get view() {
        return buildShopView(this.catalogue, { wallet: this.progress.values.wallet, equipped: this.progress.equipped },
            { tab: this.tab, selectedId: this.selectedId });
    }

    // ------------------------------------------------------------ render ----

    render() {
        const keepFocus = this.focusKey();
        const view = this.view;
        this.tab = view.tab;
        this.selectedId = view.selected?.id ?? null;
        this.stopAnimation();
        this.root.replaceChildren();

        const card = el('div', 'shop__card');
        card.append(this.renderHead(view), this.renderTabs(view));
        const body = el('div', 'shop__body');
        body.append(this.renderList(view), this.renderDetail(view));
        card.append(body);
        this.root.append(card);
        this.restoreFocus(keepFocus);
        this.startAnimation();
    }

    renderHead(view) {
        const head = el('header', 'shop__head');
        head.append(el('h2', 'shop__title', 'Shop'));
        head.append(el('p', 'shop__tag', 'Earn coins on every level. Spend them here.'));
        const wallet = el('div', 'shop__wallet');
        wallet.setAttribute('aria-live', 'polite');
        wallet.setAttribute('aria-label', `Coin balance ${view.coins}`);
        wallet.append(el('small', '', 'COINS'), el('b', 'shop__coins', view.coins.toLocaleString('en-GB')));
        const close = el('button', 'btn btn--ghost', 'Close');
        close.type = 'button';
        close.dataset.action = 'shop-close';
        close.addEventListener('click', () => this.close());
        head.append(wallet, close);
        return head;
    }

    renderTabs(view) {
        const tabs = el('div', 'shop__tabs');
        tabs.setAttribute('role', 'tablist');
        const index = view.tabs.findIndex((t) => t.id === view.tab);
        view.tabs.forEach((t, i) => {
            const button = el('button', `shop__tab${t.id === view.tab ? ' is-on' : ''}`, t.label);
            button.type = 'button';
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(t.id === view.tab));
            button.dataset.shopTab = t.id;
            button.append(el('small', '', `${t.owned}/${t.count}`));
            // Q / E (LB / RB) step the neighbouring tabs.
            if (i === (index + 1) % view.tabs.length) button.dataset.shoulderNext = '';
            if (i === (index + view.tabs.length - 1) % view.tabs.length) button.dataset.shoulderPrev = '';
            button.addEventListener('click', () => {
                this.tab = t.id;
                this.selectedId = null;
                this.confirming = false;
                this.message = { text: '', tone: '' };
                this.render();
            });
            tabs.append(button);
        });
        return tabs;
    }

    renderList(view) {
        const list = el('div', 'shop__list');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', SHOP_CATEGORIES.find((c) => c.id === view.tab).label);
        for (const item of view.items) {
            const full = this.catalogue.find((c) => c.id === item.id);
            const selected = item.id === view.selected?.id;
            const button = el('button', `shop__item${selected ? ' is-selected' : ''}${item.equipped ? ' is-equipped' : ''}${item.owned ? ' is-owned' : ''}`);
            button.type = 'button';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', String(selected));
            button.dataset.itemId = item.id;
            button.append(this.thumb(full));
            const text = el('span', 'shop__item-text');
            text.append(el('span', 'shop__item-name', item.name));
            text.append(el('span', `shop__item-meta${item.owned ? '' : ' is-price'}`, item.badge || item.priceText));
            button.append(text);
            button.addEventListener('click', () => {
                this.selectedId = item.id;
                this.confirming = false;
                this.message = { text: '', tone: '' };
                this.render();
            });
            list.append(button);
        }
        return list;
    }

    /** A small static picture of an item for the list. */
    thumb(item) {
        const box = el('span', `shop__thumb shop__thumb--${item.kind}`);
        box.setAttribute('aria-hidden', 'true');
        if (item.slot === 'targetSkin') {
            this.paintSprite(box, item.entry, 0, THUMB_SCALE);
        } else if (item.kind === 'crosshair') {
            box.innerHTML = crosshairSvg(item.entry.shape, item.entry.colour);
        } else {
            box.style.backgroundImage = `url("${item.entry.thumb}")`;
        }
        return box;
    }

    paintSprite(node, entry, frame, scale) {
        const pos = framePosition(frame, entry.cellWidth, entry.cellHeight, scale);
        Object.assign(node.style, {
            width: `${entry.cellWidth * scale}px`,
            height: `${entry.cellHeight * scale}px`,
            backgroundImage: `url("${entry.sheet}")`,
            backgroundSize: `${entry.cellWidth * scale * 5}px ${entry.cellHeight * scale * 2}px`,
            backgroundPosition: `${pos.x}px ${pos.y}px`,
        });
    }

    renderDetail(view) {
        const detail = el('section', 'shop__detail');
        const row = view.selected;
        if (!row) {
            detail.append(el('p', 'shop__empty', 'Nothing here yet.'));
            return detail;
        }
        const item = this.catalogue.find((c) => c.id === row.id);
        detail.append(this.renderPreview(item, row));
        const info = el('div', 'shop__info');
        info.append(el('small', 'shop__kind', this.kindLine(item)));
        info.append(el('h3', 'shop__name', item.name));
        info.append(el('p', `shop__price${row.owned ? ' is-owned' : ''}`, row.owned ? (row.equipped ? 'Equipped' : 'Owned') : (row.state === 'locked' ? `Locked · ${coinLabel(row.price)}` : coinLabel(row.price))));
        detail.append(info);
        detail.append(this.renderActions(item, row));
        const msg = el('p', `shop__msg${this.message.tone ? ` is-${this.message.tone}` : ''}`, this.message.text);
        msg.setAttribute('role', 'status');
        msg.setAttribute('aria-live', 'polite');
        detail.append(msg);
        return detail;
    }

    kindLine(item) {
        if (item.kind === 'bot') return `BOT · ${item.bot}`;
        if (item.kind === 'skin') return `SKIN · ${item.bot}`;
        return item.kind === 'crosshair' ? 'CROSSHAIR' : 'ARENA THEME';
    }

    renderPreview(item, row) {
        const stage = el('div', `shop__preview shop__preview--${item.kind}`);
        if (item.slot === 'targetSkin') {
            const sprite = el('div', 'shop__sprite');
            sprite.setAttribute('role', 'img');
            sprite.setAttribute('aria-label', `${item.name} preview`);
            this.sprite = { node: sprite, entry: item.entry };
            this.paintSprite(sprite, item.entry, 0, PREVIEW_SCALE);
            stage.append(sprite);
            const controls = el('div', 'shop__demo');
            for (const [mode, label] of [['hit', 'Hit'], ['death', 'Down'], ['idle', 'Idle']]) {
                const button = el('button', 'btn btn--ghost shop__demo-btn', label);
                button.type = 'button';
                button.dataset.demo = mode;
                button.addEventListener('click', () => this.playDemo(mode));
                controls.append(button);
            }
            sprite.addEventListener('click', () => this.playDemo('hit'));
            stage.append(controls);
        } else if (item.kind === 'crosshair') {
            const pad = el('div', 'shop__xhair');
            pad.innerHTML = crosshairSvg(item.entry.shape, item.entry.colour);
            stage.append(pad);
        } else {
            const pic = el('div', 'shop__theme');
            pic.style.backgroundImage = `url("${item.entry.thumb}")`;
            const swatches = el('div', 'shop__swatches');
            for (const colour of themeSwatches(item.entry)) {
                const chip = el('span', 'shop__swatch');
                chip.style.background = colour;
                swatches.append(chip);
            }
            stage.append(pic, swatches);
        }
        if (row.state === 'locked') stage.classList.add('is-locked');
        return stage;
    }

    renderActions(item, row) {
        const actions = el('div', 'shop__actions');
        if (this.confirming && row.action.kind === 'buy') {
            const confirm = el('button', 'btn btn--primary', `Confirm · ${coinLabel(item.price)}`);
            confirm.type = 'button';
            confirm.dataset.action = 'shop-confirm';
            confirm.addEventListener('click', () => this.buy(item));
            const cancel = el('button', 'btn btn--ghost', 'Cancel');
            cancel.type = 'button';
            cancel.dataset.action = 'shop-cancel';
            cancel.addEventListener('click', () => { this.confirming = false; this.message = { text: '', tone: '' }; this.render(); });
            actions.append(confirm, cancel);
            return actions;
        }
        const main = el('button', `btn ${row.action.kind === 'equipped' ? 'btn--ghost' : 'btn--primary'}`, row.action.label);
        main.type = 'button';
        main.dataset.action = `shop-${row.action.kind}`;
        if (row.action.disabled) {
            main.setAttribute('aria-disabled', 'true');
            main.disabled = true;
        }
        main.addEventListener('click', () => (row.action.kind === 'buy' ? this.askBuy(item, row) : this.equip(item)));
        actions.append(main);
        return actions;
    }

    // ----------------------------------------------------------- actions ----

    /** Buy pressed: confirm when affordable, otherwise say exactly why not. */
    askBuy(item, row) {
        if (row.state === 'ready') {
            this.confirming = true;
            this.message = { text: statusMessage(row.status, item), tone: 'info' };
        } else {
            this.message = { text: statusMessage(row.status, item), tone: 'warn' };
        }
        this.render();
    }

    buy(item) {
        const { ok, status } = this.progress.buy(item.id);
        this.confirming = false;
        this.message = ok
            ? { text: `Bought ${item.name}. Equip it to use it.`, tone: 'ok' }
            : { text: statusMessage(status, item), tone: 'warn' };
        this.handlers.onChange?.();
        this.render();
    }

    equip(item) {
        if (!this.progress.equipItem(item.id)) {
            this.message = { text: `${item.name} is not owned yet.`, tone: 'warn' };
        } else {
            const patch = equipSettingsPatch(item, this.settings.get('crosshairLength'));
            if (patch) this.settings.update(patch);
            this.message = { text: `${item.name} equipped.`, tone: 'ok' };
            this.handlers.onChange?.();
        }
        this.render();
    }

    // ----------------------------------------------------------- preview ----

    playDemo(mode) {
        this.bot = { mode, since: this.now() };
    }

    startAnimation() {
        if (!this.sprite || this.root.hidden || typeof requestAnimationFrame !== 'function') return;
        if (this.settings.get('reducedEffects')) return; // a still frame
        const tick = () => {
            if (!this.sprite) return;
            const now = this.now();
            if (this.bot.mode === 'death' && now - this.bot.since > DEATH_HOLD_MS) this.bot = { mode: 'idle', since: now };
            const { frame, mode } = botFrame(this.bot, now);
            if (mode !== this.bot.mode) this.bot = { mode, since: now };
            const { node, entry } = this.sprite;
            const pos = framePosition(frame, entry.cellWidth, entry.cellHeight, PREVIEW_SCALE);
            node.style.backgroundPosition = `${pos.x}px ${pos.y}px`;
            this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }

    stopAnimation() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.sprite = null;
    }

    // ------------------------------------------------------------- focus ----

    /** A stable key for the focused control, so a re-render does not drop focus. */
    focusKey() {
        const active = document.activeElement;
        if (!active || !this.root.contains(active)) return null;
        return active.dataset.itemId ? `item:${active.dataset.itemId}`
            : active.dataset.shopTab ? `tab:${active.dataset.shopTab}`
                : active.dataset.action ? `action:${active.dataset.action}` : active.dataset.demo ? `demo:${active.dataset.demo}` : null;
    }

    restoreFocus(key) {
        if (!key) return;
        const [type, value] = key.split(/:(.+)/);
        const selector = { item: `[data-item-id="${value}"]`, tab: `[data-shop-tab="${value}"]`, action: `[data-action="${value}"]`, demo: `[data-demo="${value}"]` }[type];
        // A confirm / buy button swaps for its twin: fall back to the main action.
        const target = (selector && this.root.querySelector(selector))
            || this.root.querySelector('.shop__actions .btn:not([disabled])') || this.root.querySelector('.shop__item.is-selected');
        target?.focus({ preventScroll: true });
    }

    /** Escape closes (the menu navigator also does this for the pad); Tab stays inside. */
    onKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (this.confirming) {
                this.confirming = false;
                this.render();
            } else {
                this.close();
            }
            return;
        }
        if (e.key !== 'Tab') return;
        const items = [...this.root.querySelectorAll('button:not([disabled])')];
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !this.root.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !this.root.contains(active))) { e.preventDefault(); first.focus(); }
    }
}
