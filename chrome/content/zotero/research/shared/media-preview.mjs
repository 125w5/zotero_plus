/* SPDX-License-Identifier: AGPL-3.0-or-later */
const activePreviews = new WeakMap();
const windowPreviews = new WeakMap();
function ensureStyles(doc) {
	if (doc.querySelector('link[data-easysch-media-preview]')) return;
	const link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
	link.rel = 'stylesheet'; link.href = new URL('./media-preview.css', import.meta.url).href;
	link.dataset.easyschMediaPreview = 'true'; (doc.head || doc.documentElement).append(link);
}
// Zotero's chrome window also receives capture-phase scroll events and bubbling
// resize events from other panes, embedded readers and iframes. Only a resize of
// this window or a scroll of a node around the trigger moves it from under the
// pointer; the others must not drop a hover the pointer is still on.
function displacesTrigger(event, trigger, win) {
	if (event.target === win) return true;
	if (event.type !== 'scroll') return false;
	for (let node = trigger; node; node = node.parentNode || (node.nodeType === 11 ? node.host : null)) if (node === event.target) return true;
	return false;
}
function windowListeners(win) {
	if (windowPreviews.has(win)) return windowPreviews.get(win);
	const listeners = new Map(), hide = event => {for (const [fn, trigger] of listeners) if (displacesTrigger(event, trigger, win)) fn();};
	win.addEventListener('scroll', hide, true); win.addEventListener('resize', hide);
	const state = {listeners, count: 0, dispose: () => {win.removeEventListener('scroll', hide, true); win.removeEventListener('resize', hide); windowPreviews.delete(win);}};
	windowPreviews.set(win, state); return state;
}
export function disposeMediaPreviews(host) {
	for (const target of [host, ...host.querySelectorAll('.research-media-trigger')]) activePreviews.get(target)?.();
}
export function installMediaPreview(target, {src, alt = '图片预览', content, onLocate, doubleClickLabel = '定位原文', onError = () => {}, hoverDelay = 320} = {}) {
	activePreviews.get(target)?.();
	const doc = target.ownerDocument, win = doc.defaultView;
	ensureStyles(doc);
	const create = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag), events = windowListeners(win); events.count++;
	let hover, dialog, backdrop, hoverTimer, clickTimer, disposed = false, restoreFocus;
	const imageSource = () => typeof src === 'function' ? src() : src || target.currentSrc || target.src;
	const fill = host => {
		if (content) {host.append(typeof content === 'function' ? content() : content.cloneNode(true)); return;}
		const image = create('img'); image.alt = alt; host.append(image);
		Promise.resolve(imageSource()).then(value => {if (host.isConnected && value) image.src = value;}).catch(onError);
	};
	const hideHover = () => {win.clearTimeout(hoverTimer); hover?.remove(); hover = null; events.listeners.delete(hideHover);};
	const positionHover = () => {
		if (!hover) return;
		const rect = target.getBoundingClientRect(), maxWidth = Math.min(460, win.innerWidth - 24);
		hover.style.width = maxWidth + 'px';
		const width = hover.offsetWidth, height = hover.offsetHeight;
		const preferredLeft = rect.right + 12, left = preferredLeft + width < win.innerWidth - 12 ? preferredLeft : Math.max(12, rect.left - width - 12);
		hover.style.left = Math.min(left, win.innerWidth - width - 12) + 'px';
		hover.style.top = Math.max(12, Math.min(rect.top, win.innerHeight - height - 12)) + 'px';
	};
	const modalKey = event => {
		if (!dialog) return;
		if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); closeModal();}
  else if (event.key === 'Tab') {const controls=[...dialog.querySelectorAll('button:not(:disabled)')],at=controls.indexOf(doc.activeElement);if(!controls.length)return;event.preventDefault();controls[(at+(event.shiftKey?-1:1)+controls.length)%controls.length].focus();}
	};
	const closeModal = () => {backdrop?.remove(); dialog = backdrop = null; win.removeEventListener('keydown', modalKey, true); if (restoreFocus?.isConnected) restoreFocus.focus(); restoreFocus = null;};
	const openModal = () => {
		if (disposed || !target.isConnected) return;
		hideHover(); closeModal();
		// Reader sidebars may live in a XUL document. Use HTML elements with an
		// explicit namespace; native <dialog>.showModal is unreliable there.
		backdrop = create('div'); backdrop.className = 'research-media-backdrop';
		dialog = create('div'); dialog.className = 'research-media-modal'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', alt); dialog.close = closeModal;
  const header=create('header');header.className='research-media-modal-header';const title=create('strong');title.textContent=alt;header.append(title);dialog.append(header);
  const body = create('div'); body.className = 'research-media-modal-content'; fill(body); dialog.append(body);
		const close = create('button'); close.type = 'button'; close.className = 'research-media-close'; close.textContent = '×'; close.title = '关闭预览 · Esc'; close.setAttribute('aria-label', '关闭预览'); close.onclick = closeModal; dialog.append(close);
  header.append(close);backdrop.append(dialog); backdrop.addEventListener('click', event=>{if(event.target===backdrop)closeModal();});
		(doc.body || doc.documentElement).append(backdrop); restoreFocus = doc.activeElement; close.focus(); win.addEventListener('keydown', modalKey, true);
	};
	const enter = () => {
		hideHover(); events.listeners.set(hideHover, target); hoverTimer = win.setTimeout(() => {
			if (disposed || !target.isConnected || dialog) return;
			hover = create('div'); hover.className = 'research-media-hover'; hover.setAttribute('aria-hidden', 'true'); fill(hover); (doc.body || doc.documentElement).append(hover); positionHover();
			hover.querySelector('img')?.addEventListener('load', positionHover, {once: true});
		}, hoverDelay);
	};
	const click = event => {event.stopPropagation(); hideHover(); win.clearTimeout(clickTimer); clickTimer = win.setTimeout(openModal, 220);};
	const dblclick = event => {event.preventDefault(); event.stopPropagation(); win.clearTimeout(clickTimer); hideHover(); if (onLocate) Promise.resolve().then(onLocate).catch(onError); else openModal();};
	const key = event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); openModal();}};
	target.classList.add('research-media-trigger'); if (target.tabIndex < 0) target.tabIndex = 0; target.setAttribute('role', 'button'); target.setAttribute('aria-label', alt + (onLocate ? '，双击' + doubleClickLabel : ''));
	for (const [type, listener] of [['pointerenter', enter], ['pointerleave', hideHover], ['focus', enter], ['blur', hideHover], ['click', click], ['dblclick', dblclick], ['keydown', key]]) target.addEventListener(type, listener);
	const dispose = () => {
		if (disposed) return;
		disposed = true; hideHover(); closeModal(); win.clearTimeout(clickTimer);
		for (const [type, listener] of [['pointerenter', enter], ['pointerleave', hideHover], ['focus', enter], ['blur', hideHover], ['click', click], ['dblclick', dblclick], ['keydown', key]]) target.removeEventListener(type, listener);
		if (--events.count === 0) events.dispose();
		activePreviews.delete(target);
	};
	activePreviews.set(target, dispose); return dispose;
}
