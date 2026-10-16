/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {renderFormulaPreview} from './formula-editor.mjs';
import {normalizeFormulaInput} from '../shared/formula-research.mjs';
const controls = new WeakMap();
export function disposeInlineFormulas(host) {
	for (const target of [host, ...host.querySelectorAll('[data-inline-formula]')]) controls.get(target)?.dispose();
}
export function focusInlineFormula(host) {controls.get(host)?.edit();}
export function updateInlineFormula(host, text) {controls.get(host)?.setValue(text);}
export function renderInlineFormula(host, {text = '', E, onChange = () => {}, onSelect = () => {}, onError = () => {}, locked = false} = {}) {
	controls.get(host)?.dispose(); const doc = host.ownerDocument, win = doc.defaultView;
	const create = (tag, className) => {const node = doc.createElement(tag); if (className) node.className = className; return node;};
	const root = create('div', 'formula-inline'), preview = create('div', 'formula-inline-rendered'), input = create('textarea', 'formula-inline-input');
	input.value = text; input.rows = 2; input.spellcheck = false; input.placeholder = '输入或粘贴 LaTeX'; input.setAttribute('aria-label', '原位编辑 LaTeX 公式'); input.disabled = locked;
	input.hidden = true; root.append(preview, input); host.append(root); host.dataset.inlineFormula = 'true';
	let disposePreview, disposed = false, editing = false, timer;
	const paint = () => {disposePreview?.(); preview.replaceChildren(); disposePreview = renderFormulaPreview(preview, input.value, {E});};
	const leave = () => {if (disposed) return; editing = false; input.hidden = true; root.dataset.editing = 'false'; paint();};
	const edit = event => {
		if (locked || disposed) return; event?.preventDefault(); event?.stopImmediatePropagation(); onSelect(); editing = true; input.hidden = false; root.dataset.editing = 'true'; input.focus({preventScroll: true});
		input.setSelectionRange(input.value.length, input.value.length);
	};
	preview.addEventListener('click', edit, true); preview.addEventListener('dblclick', edit, true);
	preview.tabIndex = 0; preview.setAttribute('role', 'button'); preview.setAttribute('aria-label', '公式，单击原位编辑');
	preview.onkeydown = event => {if (event.key === 'Enter' || event.key === ' ') edit(event);};
	input.oninput = () => {try {onChange(input.value);} catch (error) {onError(error);} win.clearTimeout(timer); timer = win.setTimeout(paint, 100);};
	input.onpaste = event => {
		const value = event.clipboardData?.getData('text/plain'); if (!value) return;
		try {const normalized = normalizeFormulaInput(value); if (normalized !== value) {event.preventDefault(); input.setRangeText(normalized, input.selectionStart, input.selectionEnd, 'end'); input.dispatchEvent(new win.Event('input', {bubbles: true}));}}
		catch (error) {event.preventDefault(); onError(error);}
	};
	input.onkeydown = event => {if (event.key === 'Escape' || event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); event.stopPropagation(); leave(); preview.focus({preventScroll: true});}};
	input.onblur = () => {if (editing) leave();};
	const copy = event => {if (event.clipboardData) {event.clipboardData.setData('text/plain', input.value); event.preventDefault();}}; preview.addEventListener('copy', copy);
	paint();
	const control = {input, edit, setValue(value) {input.value = value; paint();}, dispose() {if (disposed) return; disposed = true; win.clearTimeout(timer); disposePreview?.(); root.remove(); delete host.dataset.inlineFormula; controls.delete(host);}};
	controls.set(host, control); return control;
}
