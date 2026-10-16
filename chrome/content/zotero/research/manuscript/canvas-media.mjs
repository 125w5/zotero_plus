/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {materialAnchors} from '../shared/material-clues.mjs';
import {installMediaPreview} from '../shared/media-preview.mjs';

const installed = new WeakMap();
const visibleSource = anchor => anchor?.attachmentID || anchor?.url;
export function canvasMediaSource(block, materials = [], {materialID, imagePath, kind} = {}) {
	const related = materials.filter(material => materialID ? material.id === materialID || material.assetID === materialID
		: (block.materials || []).some(link => link.id === material.id));
	const matching = related.find(material => materialID || imagePath && material.imagePath === imagePath
		|| kind === 'table' && block.table?.binding?.materialID === material.id);
	if (matching) {const anchor = materialAnchors(matching).find(visibleSource); if (anchor) return {anchor, material: matching};}
	// An explicit source recorded on this object is stronger than an arbitrary
	// paper cited by its surrounding paragraph. Never invent media provenance.
	const anchor = (block.sourceAnchors || []).find(visibleSource);
	return anchor ? {anchor, material: matching || null} : null;
}

export function cloneCanvasTable(table, {E} = {}) {
	const clone = table.cloneNode(true);
	clone.removeAttribute('id'); clone.removeAttribute('tabindex'); clone.removeAttribute('role'); clone.classList.remove('research-media-trigger');
	for (const control of clone.querySelectorAll('.col-resize,.row-resize,.table-resize,.table-add,button')) control.remove();
	for (const node of clone.querySelectorAll('[id]')) node.removeAttribute('id');
	for (const node of clone.querySelectorAll('input,textarea,select')) node.replaceWith(clone.ownerDocument.createTextNode(node.value || ''));
	for (const node of clone.querySelectorAll('[contenteditable]')) {node.removeAttribute('contenteditable'); node.removeAttribute('role'); node.removeAttribute('tabindex');}
	for (const cell of clone.querySelectorAll('td,th')) {
		cell.classList.remove('cell-selected'); cell.style.overflowWrap = 'anywhere';
		const original = cell.querySelector('.cell-editor');
		if (original) {
			const text = original.textContent; original.replaceWith(clone.ownerDocument.createTextNode(text));
			// Cell text is already user input. Interpret explicit math delimiters,
			// never guess plain identifiers or underscores into a formula.
			if (E?.renderContent && /\$[^$]+\$|\\\(|\\\[/.test(text)) E.renderContent(cell, text);
		}
	}
	const cols = [...clone.querySelectorAll('col')], widths = cols.map(col => Number.parseFloat(col.style.width) || 0), total = widths.reduce((sum, width) => sum + width, 0);
	if (total) cols.forEach((col, index) => {col.style.width = widths[index] / total * 100 + '%';});
	clone.style.width = '100%'; clone.style.tableLayout = 'fixed'; clone.style.maxWidth = 'none';
	return clone;
}

function ensureStyles(doc) {
	if (doc.querySelector('link[data-easysch-canvas-media]')) return;
	const link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link'); link.rel = 'stylesheet'; link.href = new URL('./canvas-media.css', import.meta.url).href; link.dataset.easyschCanvasMedia = 'true'; (doc.head || doc.documentElement).append(link);
}
function previewIcon(doc) {
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true');
	const circle = doc.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', '8'); circle.setAttribute('cy', '8'); circle.setAttribute('r', '5.1');
	const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'm12 12 4.5 4.5 M5.5 8h5 M8 5.5v5'); svg.append(circle, path); return svg;
}
export function disposeCanvasMedia(host) {
	for (const element of [host, ...host.querySelectorAll('[data-canvas-media-installed]')]) installed.get(element)?.();
}
export function installCanvasMedia(host, block, {E, materials = [], onSelect = () => {}, onEdit = () => {}, onOpenAnchor, onError = () => {}, hoverDelay} = {}) {
	installed.get(host)?.(); ensureStyles(host.ownerDocument);
	const doc = host.ownerDocument, cleanups = [], created = []; let disposed = false;
	const use = (target, {kind, imagePath, materialID, content} = {}) => {
		const source = canvasMediaSource(block, materials, {kind, imagePath, materialID});
		const locate = source && onOpenAnchor ? () => onOpenAnchor(source.anchor, source.material, block) : () => onEdit(block, {kind, target});
		const select = event => {if (event.button === 0) Promise.resolve(onSelect(block)).catch(onError);}; target.addEventListener('pointerdown', select);
		cleanups.push(() => target.removeEventListener('pointerdown', select));
		cleanups.push(installMediaPreview(target, {alt: kind === 'table' ? '表格预览' : target.alt || block.text || '图片预览', ...(content ? {content} : {}), onLocate: locate, doubleClickLabel: source && onOpenAnchor ? '定位原文' : kind === 'table' ? '编辑表格' : '编辑图片', onError, ...(hoverDelay !== undefined ? {hoverDelay} : {})}));
	};
	for (const image of host.querySelectorAll('img')) {
		if (image.closest('[contenteditable="true"],.research-media-hover,.research-media-modal')) continue;
		const owner = image.closest('[data-material-id],[data-material]');
		use(image, {kind: 'image', imagePath: image.dataset.imagePath || block.imagePath, materialID: owner?.dataset.materialId || owner?.dataset.material});
	}
	for (const table of host.querySelectorAll('table')) {
		if (table.querySelector('table')) continue;
		if (table.querySelector('[contenteditable="true"],input,textarea,select,.cell-editor')) {
			const wrap = table.closest('.table-wrap') || table.parentElement;
			let caption = table.previousElementSibling;
			if (!caption || caption.localName !== 'div') {caption = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div'); caption.className = 'canvas-table-preview-heading'; table.before(caption); created.push(caption);}
			const button = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button'); button.type = 'button'; button.className = 'canvas-table-preview-button'; button.title = '停留放大 · 单击查看 · 双击编辑或定位'; button.append(previewIcon(doc)); caption.append(button); created.push(button);
			caption.classList.add('canvas-table-preview-heading'); wrap.classList.add('canvas-table-has-preview');
			use(button, {kind: 'table', content: () => cloneCanvasTable(table, {E})});
		} else use(table, {kind: 'table', materialID: table.closest('[data-material-id],[data-material]')?.dataset.materialId, content: () => cloneCanvasTable(table, {E})});
	}
	host.dataset.canvasMediaInstalled = 'true';
	const dispose = () => {if (disposed) return; disposed = true; for (const cleanup of cleanups) cleanup(); for (const node of created) node.remove(); delete host.dataset.canvasMediaInstalled; installed.delete(host);};
	installed.set(host, dispose); return dispose;
}
