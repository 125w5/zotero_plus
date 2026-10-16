/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {buildMaterialClues} from '../shared/material-clues.mjs';
import {renderSourceRuns} from '../shared/material-content.mjs';
import {installMediaPreview} from '../shared/media-preview.mjs';

const mounted = new WeakMap(), imageCaches = new WeakMap();
function pageImage(E, page) {
	if (!imageCaches.has(E)) imageCaches.set(E, new Map());
	const pageImages = imageCaches.get(E);
	const key = JSON.stringify([page.attachmentID, page.sourceVersion, page.pageIndex]);
	if (!pageImages.has(key)) {
		const job = E.assets.page({attachmentID: page.attachmentID, pageIndex: page.pageIndex}).then(value => E.previewImage(value.path));
		pageImages.set(key, job);
		job.catch(() => { if (pageImages.get(key) === job) pageImages.delete(key); });
		if (pageImages.size > 24) pageImages.delete(pageImages.keys().next().value);
	}
	return pageImages.get(key);
}

export function renderMaterialClues(host, materials, {E, onOpenAnchor, onError = () => {}, includeSummaries = true}) {
	mounted.get(host)?.();
	const document = host.ownerDocument, win = document.defaultView;
	const el = (tag, content, className) => {
		const node = document.createElement(tag);
		if (content !== undefined) node.textContent = content;
		if (className) node.className = className;
		return node;
	};
	const root = el('section', undefined, 'material-clues');
	root.setAttribute('aria-label', '素材来源线索');
	let disposed = false, observer; const mediaDisposers = [];
	const active = () => !disposed && root.isConnected;
	const action = (label, fn, parent, className) => {
		const button = el('button', label, className);
		button.type = 'button';
		button.addEventListener('click', event => { event.stopPropagation(); Promise.resolve().then(fn).catch(onError); });
		parent.append(button);
		return button;
	};
	const open = (anchor, material) => onOpenAnchor(anchor, material);
	const copyQuote = async (quote, button) => {
		const label = button.textContent;
		if (E.window?.Zotero?.Utilities?.Internal?.copyTextToClipboard) E.window.Zotero.Utilities.Internal.copyTextToClipboard(quote);
		else if (win.parent?.Zotero?.Utilities?.Internal?.copyTextToClipboard) win.parent.Zotero.Utilities.Internal.copyTextToClipboard(quote);
		else await win.navigator.clipboard.writeText(quote);
		if (active()) { button.textContent = '已复制'; win.setTimeout(() => { if (button.isConnected) button.textContent = label; }, 1200); }
	};
	const info = material => E.materialSourceInfo?.(material) || {};
	const data = buildMaterialClues(materials, {sourceInfo: info});
	const title = el('div', undefined, 'clue-heading');
	const counts = [];
	if (data.papers.length) counts.push(`${data.papers.length} 篇来源论文`);
	if (data.excerptCount) counts.push(`${data.excerptCount} 处摘录`);
	const paperNotes = new Set(data.papers.flatMap(paper => paper.materials.filter(material => material.kind === 'note').map(material => material.id)));
	for (const [kind, label] of [['abstract', '项摘要'], ['external', '项外部资料'], ['idea', '项构想'], ['data', '项数据'], ['note', '条笔记']]) {
		const count = data.other.filter(value => value.kind === kind).length + (kind === 'note' ? paperNotes.size : 0);
		if (count) counts.push(count + ' ' + label);
	}
	title.append(el('h4', data.papers.length ? '来源线索' : '素材说明'));
	if (counts.length) title.append(el('small', counts.join(' · ')));
	root.append(title);
	const description = new Set();
	for (const material of includeSummaries ? materials || [] : []) {
		const summary = E.manuscripts?.summaryFor?.(material) || material.summaryZh || material.summary || '';
		if (!summary || description.has(summary)) continue;
		description.add(summary);
		const note = el('div', undefined, 'clue-summary');
		if (E.renderContent) E.renderContent(note, summary); else note.textContent = summary;
		root.append(note);
	}
	const loaders = new WeakMap();
	if (win.IntersectionObserver) observer = new win.IntersectionObserver(entries => {
		for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); loaders.get(entry.target)?.(); }
	}, {root: host.closest('aside') || null, rootMargin: '80px'});
	for (const paper of data.papers) {
		const group = el('section', undefined, 'clue-paper clue-source');
		group.dataset.paper = paper.id;
		const heading = el('div', undefined, 'clue-paper-heading');
		heading.append(el('strong', paper.title));
		if (paper.metric?.impact_factor != null) heading.append(el('small', 'IF ' + paper.metric.impact_factor
			+ (paper.metric.metric_year ? ' · ' + paper.metric.metric_year : ''), 'clue-impact'));
		group.append(heading);
		for (const page of paper.pages) {
			const box = el('details', undefined, 'clue-page');
			box.dataset.cluePage = page.id;
			const disclosure = el('summary', undefined, 'clue-page-heading');
			disclosure.append(el('span', page.pageIndex == null ? '原文摘录' : '原文 · 第 ' + (page.pageIndex + 1) + ' 页'), el('small', page.excerpts.length + ' 处摘录'));
			box.append(disclosure);
			const row = el('div', undefined, 'clue-page-content'), excerpts = el('div', undefined, 'clue-excerpts');
			row.append(excerpts);
			for (const clue of page.excerpts) {
				const excerpt = el('article', undefined, 'clue-excerpt');
				excerpt.dataset.clue = clue.id;
				if (clue.kind !== 'excerpt') excerpt.append(el('small', clue.coverage, 'clue-boundary'));
				const original = el(clue.kind === 'note' ? 'p' : 'blockquote', undefined, clue.kind === 'note' ? 'clue-local-text' : 'clue-quote');
				const primary = clue.materials[0], formulaImage = primary?.imagePath && (primary.kind === 'formula' || primary.category === '公式');
				// A raw formula extracted from a PDF does not retain two-dimensional
				// geometry. Its original image is the source, not guessed inline TeX.
				if (!formulaImage) renderSourceRuns(original, clue.quote || '来源位置已保存，未保存文字摘录。', primary?.captionRuns || primary?.sourceRuns);
				if (original.textContent) excerpt.append(original);
				const controls = el('div', undefined, 'clue-actions');
				const material = clue.materials[0];
				const location = clue.kind === 'note' && material?.sourceItemID
					? action('打开来源笔记', () => open({...clue.anchor, attachmentID: null}, material), controls)
					: clue.anchor.attachmentID ? action(clue.kind === 'note' ? '查看关联论文' : '定位原文', () => open(clue.anchor, material), controls)
						: clue.anchor.url ? action('打开来源', () => open(clue.anchor, material), controls)
							: material?.sourceItemID ? action('打开来源笔记', () => open(clue.anchor, material), controls) : null;
				if (location) {
					location.dataset.clueOpen = clue.id;
					location.dataset.attachment = clue.anchor.attachmentID ?? '';
					location.dataset.page = clue.anchor.pageIndex ?? '';
				}
				if (clue.quote) {
					const button = action(clue.kind === 'note' ? '复制笔记' : '复制摘录', () => copyQuote(clue.quote, button), controls);
					button.dataset.clueCopy = clue.id;
				}
				excerpt.append(controls);
				excerpts.append(excerpt);
			}
			if (page.attachmentID && page.pageIndex != null && E.assets?.page) {
				const thumbnail = el('div', undefined, 'clue-thumbnail'); row.append(thumbnail);
				thumbnail.title = '停留放大 · 单击查看 · 双击定位';
				thumbnail.dataset.clueOpen = page.excerpts[0].id;
				thumbnail.dataset.attachment = page.attachmentID;
				thumbnail.dataset.page = page.pageIndex;
				thumbnail.setAttribute('aria-label', '定位到第 ' + (page.pageIndex + 1) + ' 页原文');
				const image = el('img');
				image.alt = '第 ' + (page.pageIndex + 1) + ' 页缩略图';
				image.loading = 'lazy';
				const loadingLabel = el('small', '读取页预览…', 'clue-thumbnail-status');
				thumbnail.setAttribute('aria-busy', 'true');
				thumbnail.append(image, loadingLabel);
				mediaDisposers.push(installMediaPreview(thumbnail, {src: () => image.src || pageImage(E, page), alt: image.alt, onLocate: () => open(page.excerpts[0].anchor, page.excerpts[0].materials[0]), onError}));
				let loading = false;
				const load = async () => {
					if (loading || !active()) return;
					loading = true;
					try { const src = await pageImage(E, page); if (active() && thumbnail.isConnected) { image.src = src; loadingLabel.remove(); thumbnail.setAttribute('aria-busy', 'false'); } }
					catch (error) { if (active() && thumbnail.isConnected) { image.remove(); loadingLabel.textContent = '缩略图暂不可用'; thumbnail.setAttribute('aria-busy', 'false'); thumbnail.title = '缩略图暂不可用，点击仍可定位原文'; } }
				};
				loaders.set(thumbnail, load);
				thumbnail.addEventListener('pointerenter', load, {once: true});
				thumbnail.addEventListener('focus', load, {once: true});
				box.addEventListener('toggle', () => { if (box.open) load(); });
				observer?.observe(thumbnail);
			}
			box.append(row);
			group.append(box);
		}
		root.append(group);
	}
	for (const {material, kind, label, anchors = []} of data.other) {
		const block = el('article', undefined, 'clue-local clue-local-' + kind);
		block.append(el('strong', E.manuscripts?.titleFor?.(material) || material.title || '用户资料'), el('small', label, 'clue-boundary'));
		if (material.data?.rows?.length) {
			const table = el('table', undefined, 'clue-data');
			for (const [index, row] of material.data.rows.slice(0, 5).entries()) {
				const tr = el('tr');
				for (const value of row.slice(0, 5)) tr.append(el(index ? 'td' : 'th', String(value ?? '')));
				table.append(tr);
			}
			block.append(table);
		} else if (kind === 'abstract' || kind === 'external') {
			for (const anchor of anchors) {
				const excerpt = el('article', undefined, 'clue-excerpt');
				const quote = anchor.sourceText || material.sourceText;
				if (quote) excerpt.append(el('blockquote', quote, 'clue-quote'));
				if (anchor.url) {
					const controls = el('div', undefined, 'clue-actions');
					const source = action('打开来源', () => open(anchor, material), controls);
					source.dataset.clueOpen = material.id;
					source.title = anchor.url;
					excerpt.append(controls);
				}
				block.append(excerpt);
			}
		} else if (material.sourceText) block.append(el('p', material.sourceText, 'clue-local-text'));
		root.append(block);
	}
	if (!data.papers.length && !data.other.length) root.append(el('p', '本段尚未关联素材。选择左侧素材可以查看来源线索。', 'clue-empty'));
	host.append(root);
	const dispose = () => { disposed = true; observer?.disconnect(); for (const cleanup of mediaDisposers) cleanup(); root.remove(); if (mounted.get(host) === dispose) mounted.delete(host); };
	mounted.set(host, dispose);
	return Object.assign(dispose, {element: root, data});
}
