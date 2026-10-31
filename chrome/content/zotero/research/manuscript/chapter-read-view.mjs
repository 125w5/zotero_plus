/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The chapter read (装配速读) on the assembly canvas, drawn from
// U.chapterReads.viewModel() in the reader's 速读 presentation. Node bodies keep
// .framework-narrative inside [data-read-node] with data-framework-section and
// data-framework-node, so the selection assistant and answer drops work on them.
// Every block of a chapter is listed under it; the user's text is never edited here.
import { assemblyCanvasMode } from '../shared/assembly-direction.mjs';
import { THREAD_LABELS, READ_REFRESH_STATES } from '../shared/research-thread.mjs';
import { rapidAssetPresentation } from '../shared/rapid-reading-assets.mjs';
import { materialPreview } from '../shared/material-browser.mjs';
import { materialAnchors } from '../shared/material-clues.mjs';
import { chapterBlockRows } from './assembly-placement.mjs';
import { mathText, readableMath } from './assembly-navigation.mjs';

const GAP_LABELS = Object.freeze({ evidence: '证据', experiment: '实验', figure: '图表', decision: '方向', structure: '结构' });
const CHANGED_LABELS = Object.freeze({ global: '研究范围或速读规则', plan: '可行性方案', decisions: '方向与决定', materials: '本章素材', corpus: '语料', blocks: '章节模块', authored: '已写正文', section: '章节' });
const TYPE_ICONS = Object.freeze({ formula: '∑', table: '▦', image: '▧', heading: 'H', citation: '❞', list: '•' });
export const READ_UNDO_NOTE = 'Ctrl+Z 只撤销正文编辑；速读的修改用“恢复 AI 解析”或候选的“撤回修改”还原。';

// [素材 · PDF 第 n 页]. Manual corpus rows never claim a page.
export function readEvidenceLabel(row, titleFor = value => value?.title || '') {
	let title = String(titleFor(row) || row?.title || '素材').replace(/\s+/g, ' ')
		.trim()
		.slice(0, 40);
	return [title, row?.state === 'removed' ? row.stateLabel : row?.manual ? '手工条目 · 需核验' : row?.pageLabel || ''].filter(Boolean).join(' · ');
}

export function readPlanRefLabel(ref) {
	let value = String(ref || ''), match = value.match(/^(pending|openQuestions|closest)\.(\d+)$/);
	if (match) return { pending: '待补项 ', openQuestions: '待讨论问题 ', closest: '接近工作 ' }[match[1]] + (Number(match[2]) + 1);
	return { minimumValidation: '最小验证', task: '本章任务' }[value] || value;
}

// Figures follow the node that cites them; the others close the chapter.
export function readFigurePlacement(chapter) {
	let nodes = new Set((chapter?.nodes || []).map(row => row.id)), after = new Map(), loose = [];
	for (let figure of chapter?.figures || []) {
		if (!figure.afterNodeID || !nodes.has(figure.afterNodeID)) { loose.push(figure); continue; }
		if (!after.has(figure.afterNodeID)) after.set(figure.afterNodeID, []);
		after.get(figure.afterNodeID).push(figure);
	}
	return { after, loose };
}

// The anchor of a multi-anchor material that holds the quote, so 核对原文
// opens the page its label names.
export function readQuoteAnchor(row, anchors = []) {
	let quote = String(row?.quote || '').slice(0, 40);
	let match = quote && anchors.find(anchor => anchor?.attachmentID && String(anchor.sourceText || '').includes(quote));
	return match || (row?.anchor?.attachmentID ? row.anchor : anchors.find(anchor => anchor?.attachmentID) || row?.anchor || null);
}

let menuBounds = ({ x, y, width, height, viewportWidth, viewportHeight }) => {
	let gap = 8, available = Math.max(1, viewportHeight - gap * 2), menuHeight = Math.min(Math.max(1, height), available), menuWidth = Math.min(width, Math.max(1, viewportWidth - gap * 2));
	return { left: Math.max(gap, Math.min(x, viewportWidth - menuWidth - gap)), top: Math.max(gap, Math.min(y + gap, viewportHeight - menuHeight - gap)), maxHeight: available, width: menuWidth };
};
export function installChapterReadView(U, { el, button, status = () => {}, renderPlaceholder, selectBlock, materialDetails, openMaterial } = {}) {
	let doc = U.$('canvas').ownerDocument, win = doc.defaultView || globalThis;
	if (!doc.querySelector?.('link[data-chapter-read-view]')) {
		let link = el('link'); link.rel = 'stylesheet'; link.href = new URL('./chapter-read-view.css', import.meta.url).href; link.dataset.chapterReadView = 'true';
		doc.head?.append(link);
	}
	let editor = null, menu = null, frame = 0, renders = 0, entries = new Map(), formulas = [], showFormulas = false;
	let reading = () => assemblyCanvasMode(U.p, { readView: true }) === 'read';
	let titleFor = row => U.A.titleFor?.(row) || row?.title || '';
	let renderText = (host, text) => { if (U.E.renderContent) U.E.renderContent(host, text); else host.textContent = text; };
	// A re-render waits while a node is being edited; the edit is not lost.
	let deferred = false;
	let schedule = () => {
		if (!reading()) return;
		if (editor) { deferred = true; return; }
		if (frame) return;
		let scheduled = renders;
		frame = win.requestAnimationFrame(() => { frame = 0; if (scheduled === renders && reading() && !editor) U.renderEditor?.(); });
	};
	let closeMenu = () => { menu?.remove(); menu = null; };
	let place = (popup, anchor, event) => {
		let box = anchor?.getBoundingClientRect?.() || { left: 8, top: 48 }, bounds = menuBounds({ x: event?.clientX ?? box.left, y: event?.clientY ?? box.top, width: 340, height: popup.scrollHeight || 240, viewportWidth: win.innerWidth || 1024, viewportHeight: win.innerHeight || 768 });
		popup.style.width = bounds.width + 'px'; popup.style.left = bounds.left + 'px'; popup.style.top = bounds.top + 'px'; popup.style.maxHeight = bounds.maxHeight + 'px';
	};
	let locate = async row => {
		let material = U.p.materials.find(item => item.id === row.materialID);
		if (!material) throw Error('来源已移除');
		let anchor = readQuoteAnchor(row, materialAnchors(material));
		if (anchor?.attachmentID && U.E.library?.openSource) { await U.E.library.openSource(anchor); return; }
		await openMaterial?.(material, undefined, anchor || undefined);
	};
	let showMaterial = material => { U.selectionAssistant?.showDetails?.(); materialDetails?.(material); };
	let viewText = blockID => { U.chapterReads?.setView('text'); if (blockID) selectBlock?.(blockID, { scroll: true }); };
	// 核对原文: the stored quotes with their PDF page; no model call.
	function openEvidence(chapter, node, anchor, event) {
		closeMenu();
		let popup = menu = el('aside', undefined, 'assembly-read-menu');
		popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '速读要点的原文依据');
		popup.append(el('strong', THREAD_LABELS.verifyRead + ' · ' + (node.claim || chapter.title).slice(0, 40)));
		if (!node.evidence.length) popup.append(el('small', undefined, node.status === 'planned' ? '这是方案中的计划，尚未执行，没有原文依据。' : '这条要点没有绑定原文摘录。'));
		for (let row of node.evidence) {
			let group = el('section', undefined, 'easysch-rapid-evidence');
			group.append(el('small', readEvidenceLabel(row, item => titleFor(U.p.materials.find(value => value.id === item.materialID)) || item.title)));
			if (row.stateLabel) group.append(el('small', row.stateLabel));
			group.append(el('blockquote', row.quote));
			let material = U.p.materials.find(item => item.id === row.materialID);
			if (row.state !== 'removed' && !row.manual) button('在原文中定位', () => locate(row), group);
			if (material) button('查看素材', () => { closeMenu(); showMaterial(material); }, group);
			popup.append(group);
		}
		let refs = [...node.planRefs.map(readPlanRefLabel), ...node.decisionRefs.map(() => '方向选择')];
		if (refs.length) popup.append(el('small', '关联方案：' + [...new Set(refs)].join('、')));
		for (let blockID of (node.authorBlockIDs || []).slice(0, 3)) if (U.p.blocks.some(row => row.id === blockID)) button('查看对应正文', () => { closeMenu(); viewText(blockID); }, popup);
		popup.append(el('small', '双击要点可编辑速读；选中文字后可在右栏解释或忠实改写。'));
		doc.body.append(popup); place(popup, anchor, event);
		return popup;
	}
	// Double-click edits the read point as an overlay; the AI text stays stored.
	function editNode(entry, draft = null) {
		if (!entry || U.composing) return;
		closeMenu();
		if (editor && editor.entry !== entry) editor.cancel();
		let { chapter, node, item, body } = entry, area = el('textarea'), actions = el('div', undefined, 'easysch-rapid-edit-actions'), hint = el('small', '只修改本条速读，不改正文');
		area.value = draft?.value ?? node.text; area.setAttribute('aria-label', '编辑速读要点');
		let close = () => { if (editor?.entry === entry) editor = null; item.classList.remove('is-editing'); };
		let cancel = () => { close(); body.replaceChildren(); renderText(body, node.text); if (deferred) { deferred = false; schedule(); } };
		editor = { entry, area, cancel };
		let save = button('保存', () => {
			let value = area.value.trim();
			if (!value) throw Error('速读要点不能为空；可用“' + THREAD_LABELS.restoreRead + '”还原');
			U.chapterReads.edit(chapter.sectionID, node.id, value);
			close(); U.renderEditor?.();
		}, actions);
		button('取消', cancel, actions); actions.append(hint);
		area.onkeydown = event => {
			if (event.isComposing || event.keyCode === 229) return;
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
			else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); save.click(); }
		};
		body.replaceChildren(area, actions); item.classList.add('is-editing');
		area.focus?.();
		let start = draft?.start ?? area.value.length;
		area.setSelectionRange?.(start, draft?.end ?? start);
	}
	function renderUpdate(chapter, node, host) {
		let box = el('div', undefined, 'assembly-read-update');
		box.append(el('strong', '速读有更新建议 · 红色为删除，绿色为新增'));
		let diff = el('div', undefined, 'assembly-read-diff');
		for (let part of node.pendingUpdate.diff || []) diff.append(el(part.kind === 'delete' ? 'del' : part.kind === 'insert' ? 'ins' : 'span', part.text));
		box.append(diff);
		let actions = el('div', undefined, 'easysch-rapid-edit-actions');
		// Accepting the update is the primary action; it uses the shared primary
		// button (workspace-controls.css), not the white secondary row style.
		button('采用更新', () => U.chapterReads.acceptUpdate(chapter.sectionID, node.id), actions, 'primary').dataset.action = 'accept-read-update';
		button('保留我的版本', () => U.chapterReads.dismissUpdate(chapter.sectionID, node.id), actions).dataset.action = 'dismiss-read-update';
		box.append(actions); host.append(box);
	}
	function renderNode(chapter, node, host) {
		let item = el('div', undefined, 'easysch-rapid-point' + (node.edited ? ' is-user-edited' : ''));
		item.dataset.readNode = node.id; item.dataset.frameworkNode = node.id; item.dataset.role = node.role; item.dataset.status = node.status;
		let label = el('div', undefined, 'assembly-read-point-label');
		label.append(el('span', node.roleLabel || node.role));
		if (node.claim && node.claim !== node.text) label.append(el('strong', node.claim));
		label.append(el('span', node.statusLabel || node.status, 'assembly-read-point-status'));
		let body = el('div', undefined, 'easysch-rapid-point-body framework-narrative');
		body.tabIndex = 0; body.title = '单击核对原文；双击编辑；选中文字可解释或忠实改写';
		renderText(body, node.text);
		let meta = el('div', undefined, 'easysch-rapid-point-meta'), entry = { chapter, node, item, body };
		for (let row of node.evidence) {
			let chip = button(readEvidenceLabel(row, value => titleFor(U.p.materials.find(material => material.id === value.materialID)) || value.title), event => openEvidence(chapter, node, chip, event), meta, 'assembly-read-evidence');
			chip.dataset.state = row.state; chip.title = row.quote.slice(0, 200);
		}
		if (node.edited) {
			meta.append(el('small', node.retainedManual ? '用户已修改 · 新版速读不再包含此要点' : '用户已修改'));
			button(node.retainedManual ? '按新版移除' : THREAD_LABELS.restoreRead, () => U.chapterReads.revert(chapter.sectionID, node.id), meta).dataset.action = 'restore-read-node';
		}
		item.append(label, body, meta);
		if (node.pendingUpdate) renderUpdate(chapter, node, item);
		let timer = 0, selecting = () => { let selection = win.getSelection?.(); return !!selection && !selection.isCollapsed && body.contains?.(selection.anchorNode); };
		body.onclick = event => {
			if (editor || selecting() || event.detail > 1 || event.target?.closest?.('textarea,button,input')) return;
			win.clearTimeout(timer); timer = win.setTimeout(() => { if (!editor && !selecting()) openEvidence(chapter, node, body, event); }, 230);
		};
		body.ondblclick = event => { if (event.target?.closest?.('textarea,button,input')) return; win.clearTimeout(timer); event.preventDefault(); editNode(entry); };
		body.onkeydown = event => {
			if (editor || event.target !== body) return;
			if (event.key === 'Enter') { event.preventDefault(); openEvidence(chapter, node, body); }
			else if (event.key === 'F2') { event.preventDefault(); editNode(entry); }
		};
		entries.set(chapter.sectionID + '\0' + node.id, entry);
		host.append(item);
	}
	function renderChapter(chapter, host, view) {
		let section = el('section', undefined, 'assembly-read-chapter');
		section.dataset.frameworkSection = chapter.sectionID; section.dataset.section = chapter.sectionID; section.dataset.readState = chapter.state;
		let heading = el('div', undefined, 'assembly-read-chapter-heading'), active = view.running && view.progress.includes('《' + chapter.title + '》');
		heading.append(el('h2', chapter.title));
		let chip = el('span', active ? '整理中' : chapter.stateLabel || chapter.state, 'assembly-read-state');
		chip.dataset.state = active ? 'running' : chapter.state;
		if (chapter.changed.length) chip.title = '已变化：' + [...new Set(chapter.changed.map(part => CHANGED_LABELS[part] || part))].join('、');
		heading.append(chip);
		let refresh = button(chapter.state === 'missing' ? THREAD_LABELS.generateRead : THREAD_LABELS.updateChapterRead, () => U.chapterReads.refresh({ onlyStale: false, sectionIDs: [chapter.sectionID] }), heading, 'quiet-action');
		refresh.dataset.action = 'refresh-chapter-read'; refresh.disabled = view.running || !!U.busy;
		section.append(heading);
		let task = el('p', undefined, 'assembly-read-task');
		task.append(el('strong', '本章任务'), el('span', chapter.task || '方案尚未给出本章任务；按章节用途整理。'));
		if (chapter.taskSource === 'purpose') task.title = '方案没有本章任务，沿用章节的写作用途';
		if (chapter.routeChips.length) {
			let chips = el('span', undefined, 'assembly-read-chips');
			for (let row of chapter.routeChips) { let node = el('span', row.label, 'assembly-read-chip'); node.dataset.kind = row.kind; chips.append(node); }
			task.append(chips);
		}
		section.append(task);
		if (chapter.error) { let notice = el('p', '本章未完成：' + chapter.error.message + '；可重新整理本章，已完成的章节保留。', 'assembly-read-notice'); notice.dataset.kind = 'error'; section.append(notice); }
		if (chapter.brief?.text) { let brief = el('aside', undefined, 'easysch-rapid-glance'); renderText(brief, chapter.brief.text); section.append(brief); }
		for (let text of [chapter.local ? '本章尚未关联可读取的原文素材；以下内容来自章节任务与方案，均不是原文证据。' : '', chapter.depthLimited ? '本章可读取的原文有限，速读较短；补充素材或语料后可更新。' : '', chapter.incomplete ? '本章速读在输出长度上限处中断，保留了 ' + (chapter.incomplete.keptNodes ?? chapter.nodes.length) + ' 个完整要点；重新整理可补全。' : ''].filter(Boolean)) section.append(el('p', text, 'assembly-read-notice'));
		if (!chapter.nodes.length && !chapter.error) section.append(el('p', active ? '正在整理本章速读…' : chapter.state === 'missing' ? '本章尚未生成速读。' : '本章速读没有可显示的要点，可重新整理。', 'assembly-read-notice'));
		let { after, loose } = readFigurePlacement(chapter);
		for (let node of chapter.nodes) { renderNode(chapter, node, section); for (let figure of after.get(node.id) || []) renderFigure(figure, section); }
		for (let figure of loose) renderFigure(figure, section);
		renderGaps(chapter, section); renderBlocks(chapter, section); renderOmitted(chapter, section); renderFooter(chapter, section);
		host.append(section);
		return section;
	}
	// Linked figures, tables and formulas of the chapter's materials, as in the
	// reader; formulas stay hidden until 显示公式. AI images never reach here.
	function renderFigure(figure, host) {
		let material = figure.material, kind = ['image', 'figure'].includes(figure.kind) ? 'figure' : figure.kind === 'table' ? 'table' : 'formula';
		let view = rapidAssetPresentation({ id: figure.id, kind, label: figure.title, caption: figure.caption, path: material?.imagePath || '' }, material);
		let visuals = el('div', undefined, 'easysch-rapid-visuals'), box = el('figure');
		visuals.dataset.assetKind = kind; visuals.dataset.materialId = figure.materialID; visuals.hidden = kind === 'formula' && !showFormulas;
		if (kind === 'formula') formulas.push(visuals);
		visuals.append(box);
		if (material) materialPreview(box, material, U.E, { onOpenAnchor: () => openMaterial?.(material), onError: error => status(error.message, true) });
		else box.append(el('small', '来源已移除'));
		let caption = el('figcaption'), detail = el('div', undefined, 'easysch-rapid-figure-detail'), summary;
		let expand = () => {
			let open = detail.hidden;
			detail.hidden = !open; summary.setAttribute('aria-expanded', String(open));
			if (open && !detail.childElementCount) { renderText(detail, material ? U.A.summaryFor?.(material) || material.summary || figure.caption || '中文说明待整理' : figure.caption || ''); if (material) button('查看素材', () => showMaterial(material), detail, 'quiet-action'); }
		};
		summary = button(view.summary, expand, undefined, 'easysch-rapid-figure-summary');
		summary.setAttribute('aria-expanded', 'false'); detail.hidden = true;
		caption.append(el('span', view.label, 'easysch-rapid-figure-label'), summary, detail);
		box.append(caption); host.append(visuals);
	}
	function renderGaps(chapter, host) {
		if (!chapter.gaps.length) return;
		let box = el('section', undefined, 'assembly-read-gaps'), list = el('ul');
		box.append(el('h3', '缺口待办'));
		for (let gap of chapter.gaps) { let row = el('li'); row.dataset.gapId = gap.id; row.append(el('span', GAP_LABELS[gap.kind] || '待办', 'assembly-read-gap-kind'), el('span', gap.text)); list.append(row); }
		box.append(list); host.append(box);
	}
	// Every block of the chapter, so the outline and the read always agree:
	// cards without the user's text appear as placeholders, written blocks as a
	// short line that opens the text view.
	function renderBlocks(chapter, host) {
		let rows = chapterBlockRows(U.p, chapter.sectionID);
		if (!rows.length) return;
		let box = el('section', undefined, 'assembly-read-blocks');
		box.append(el('h3', '本章正文与素材 · ' + rows.length + ' 个模块'));
		for (let { block, placeholder } of rows) {
			let row = el('div', undefined, 'assembly-read-block' + (block.id === U.p.ui.blockID ? ' selected' : ''));
			row.dataset.readBlock = block.id;
			if (placeholder) renderPlaceholder?.(row, block);
			else {
				let line = el('div', undefined, 'assembly-read-block-text');
				line.append(el('span', TYPE_ICONS[block.type] || '¶', 'outline-type'), el('span', blockPreview(block)));
				line.onclick = event => { if (event.target?.closest?.('button')) return; selectBlock?.(block.id); };
				button(THREAD_LABELS.viewText, event => { event?.stopPropagation?.(); viewText(block.id); }, line, 'quiet-action');
				row.append(line);
			}
			box.append(row);
		}
		host.append(box);
	}
	function blockPreview(block) {
		if (block.type === 'table') return '表格 · ' + (block.table?.caption ? readableMath(block.table.caption) : (block.table?.rows?.length || 0) + ' 行');
		if (block.type === 'image') return '图片 · ' + (block.text ? readableMath(block.text) : '未写图注');
		if (block.type === 'formula') return '公式 · ' + mathText(block.text).slice(0, 60);
		if (block.type === 'citation') return '引用 · ' + (block.text || '');
		return readableMath(block.text || '').replace(/\s+/g, ' ')
			.trim()
			.slice(0, 90) || '空白段落';
	}
	function renderOmitted(chapter, host) {
		if (!chapter.omitted.length) return;
		let box = el('details', undefined, 'assembly-read-omitted');
		box.append(el('summary', '未作为证据的素材 · ' + chapter.omitted.length));
		for (let row of chapter.omitted.slice(0, 40)) box.append(el('p', (row.title || '素材') + '：' + row.label));
		host.append(box);
	}
	function renderFooter(chapter, host) {
		if (!chapter.at) return;
		let read = chapter.coverage.reduce((sum, row) => sum + (row.readCharacters || 0), 0), total = chapter.coverage.reduce((sum, row) => sum + (row.totalCharacters || 0), 0);
		let parts = [chapter.coverage.length ? '读取 ' + chapter.coverage.length + ' 份来源 · ' + read + ' / ' + total + ' 字' + (chapter.coverage.some(row => row.truncated) ? '（部分超出本次读取上限）' : '') : '', chapter.model ? '模型 ' + chapter.model : '', '整理于 ' + new Date(chapter.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })];
		host.append(el('p', parts.filter(Boolean).join(' · '), 'assembly-read-footer'));
	}
	function renderToolbar(view, host) {
		let bar = el('div', undefined, 'assembly-read-toolbar'), made = view.chapters.filter(row => row.nodes.length).length, stale = view.chapters.filter(row => READ_REFRESH_STATES.includes(row.state)).length;
		let progress = el('span', view.running ? view.progress || '正在整理装配速读…' : made + ' / ' + view.chapters.length + ' 章已有速读' + (stale ? ' · ' + stale + ' 章待更新' : ''), 'assembly-read-progress');
		progress.dataset.readProgress = 'true'; progress.setAttribute('role', 'status'); bar.append(progress);
		if (view.running) button('停止', () => U.readAbort?.abort(), bar, 'assembly-read-action').dataset.action = 'stop-chapter-reads';
		else if (stale) {
			let refresh = button(made ? THREAD_LABELS.updateStaleReads : THREAD_LABELS.generateRead, () => U.chapterReads.refresh({ onlyStale: true }), bar, 'assembly-read-action primary');
			refresh.dataset.action = 'chapter-read'; refresh.disabled = !!U.busy;
		}
		if (view.chapters.some(row => row.figures.some(figure => figure.kind === 'formula'))) {
			let toggle = button(showFormulas ? '隐藏公式' : '显示公式', () => { showFormulas = !showFormulas; toggle.textContent = showFormulas ? '隐藏公式' : '显示公式'; toggle.setAttribute('aria-pressed', String(showFormulas)); for (let node of formulas) node.hidden = !showFormulas; }, bar, 'easysch-rapid-control');
			toggle.setAttribute('aria-pressed', String(showFormulas)); toggle.dataset.action = 'toggle-read-formulas';
		}
		button(THREAD_LABELS.viewText, () => viewText(), bar, 'easysch-rapid-control').dataset.action = 'view-assembly-text';
		host.append(bar);
	}
	function renderNavigation(view, host) {
		if (view.chapters.length < 2) return;
		let nav = el('nav', undefined, 'easysch-rapid-tabs');
		nav.setAttribute('aria-label', '章节');
		for (let chapter of view.chapters) {
			let chip = button(chapter.title, () => entries.get('section\0' + chapter.sectionID)?.scrollIntoView?.({ block: 'start' }), nav);
			chip.append(el('small', chapter.stateLabel || ''));
			chip.dataset.readSection = chapter.sectionID;
		}
		host.append(nav);
	}
	function renderUnassigned(view, host) {
		let rows = (view.unassigned || []).filter(row => !row.sectionID);
		if (!rows.length) return;
		let section = el('section', undefined, 'assembly-read-chapter');
		section.append(el('h2', '未对应章节'), el('p', '方案中的这些章节任务没有对应到当前章节结构；可修改方案或章节名称后重新进入装配。', 'assembly-read-notice'));
		for (let row of rows) { let task = el('p', undefined, 'assembly-read-task'); task.append(el('strong', row.title || '章节'), el('span', row.task || '')); section.append(task); }
		host.append(section);
	}
	// Called by renderEditor in read mode; false falls back to the user's text.
	function render(canvas) {
		let controller = U.chapterReads;
		if (!controller) return false;
		let view = controller.viewModel(), draft = editor ? { sectionID: editor.entry.chapter.sectionID, nodeID: editor.entry.node.id, value: editor.area.value, start: editor.area.selectionStart, end: editor.area.selectionEnd } : null;
		renders++; editor = null; deferred = false; closeMenu(); entries = new Map(); formulas = [];
		let article = el('article', undefined, 'assembly-read-article easysch-rapid-article');
		article.dataset.readView = 'true';
		article.append(el('h1', view.title || '装配速读'), el('p', '装配速读 · 按章节整理的研究笔记，依据素材与方案，不是论文正文', 'easysch-rapid-authors'));
		renderToolbar(view, article); renderNavigation(view, article);
		article.append(el('p', READ_UNDO_NOTE, 'assembly-read-note'));
		for (let chapter of view.chapters) entries.set('section\0' + chapter.sectionID, renderChapter(chapter, article, view));
		renderUnassigned(view, article);
		canvas.append(article);
		if (draft) editNode(entries.get(draft.sectionID + '\0' + draft.nodeID), draft);
		return true;
	}
	if (U.chapterReads) {
		U.chapterReads.onChange = schedule;
		U.chapterReads.onProgress = text => { for (let node of doc.querySelectorAll?.('[data-read-progress]') || []) node.textContent = text; };
	}
	let dismiss = event => { if (menu && !menu.contains(event.target)) closeMenu(); };
	let escape = event => { if (menu && event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); closeMenu(); } };
	doc.addEventListener?.('pointerdown', dismiss, true);
	doc.addEventListener?.('keydown', escape, true);
	win.addEventListener?.('pagehide', event => { if (event.target !== doc) return; doc.removeEventListener?.('pointerdown', dismiss, true); doc.removeEventListener?.('keydown', escape, true); if (frame) win.cancelAnimationFrame?.(frame); closeMenu(); }, { once: true });
	U.renderChapterReads = canvas => render(canvas);
	U.chapterReadView = { render, openEvidence: (sectionID, nodeID, event) => { let entry = entries.get(sectionID + '\0' + nodeID); if (entry) openEvidence(entry.chapter, entry.node, entry.body, event); return !!entry; }, close: closeMenu, schedule };
	return U.chapterReadView;
}
