/* SPDX-License-Identifier: AGPL-3.0-or-later */
const HTML = 'http://www.w3.org/1999/xhtml';
const TITLES = {
	agent: '正在打开研究对话',
	search: '正在打开文献检索',
	discovery: '正在打开文献检索',
	writing: '正在打开论文装配',
	ppt: '正在打开组会 PPT',
	notebook: '正在打开论文项目'
};

// A short operation never paints a loading window. Each route owns a lease so
// completion of an older request cannot dismiss the latest route's window.
export function installWorkspaceLoading(doc, win, container, {delay = 160, placement = 'workspace'} = {}) {
	const node = (tag, className) => {
		const value = doc.createElementNS(HTML, tag);
		value.className = className;
		return value;
	};
	const style = node('link', 'workspace-loading-styles');
	style.rel = 'stylesheet';
	style.href = 'chrome://zotero/content/research/shared/workspace-loading.css';
	(doc.head || doc.documentElement).append(style);
	const root = node('div', 'workspace-loading library-workspace-loading');
	root.hidden = true;
	root.dataset.placement = placement;
	root.dataset.state = 'idle';
	const card = node('div', 'workspace-loading-card');
	card.setAttribute('role', 'status');
	card.setAttribute('aria-live', 'polite');
	card.setAttribute('aria-atomic', 'true');
	const spinner = node('span', 'workspace-loading-spinner');
	spinner.setAttribute('aria-hidden', 'true');
	const copy = node('div', 'workspace-loading-copy');
	const title = node('strong', 'workspace-loading-title');
	const detail = node('span', 'workspace-loading-detail');
	copy.append(title, detail);
	card.append(spinner, copy);
	root.append(card);
	container.append(root);
	let timer, revision = 0, disposed = false, globalLease;
	const nativeProgress = () => {
		try {
			let current = win;
			for (let depth = 0; depth < 8 && current; depth++) {
				if (current._researchTaskProgress?.root?.isConnected) return current._researchTaskProgress;
				const parent = current.frameElement?.ownerGlobal || current.parent;
				if (!parent || parent === current) break;
				current = parent;
			}
		} catch {/* Standalone previews retain their local loading fallback. */}
		return null;
	};
	const localize = (element, id, args, fallback) => {
		element.textContent = fallback;
		doc.l10n?.setAttributes(element, id, args);
	};
	function clear() {
		revision++;
		win.clearTimeout(timer);
		globalLease?.close();
		globalLease = undefined;
		timer = undefined;
		root.hidden = true;
		root.dataset.state = 'idle';
		container.setAttribute('aria-busy', 'false');
	}
	function begin(mode, phase = 'opening') {
		clear();
		if (disposed) return {update() {}, close() {}};
		const owner = revision;
		root.dataset.mode = mode;
		root.dataset.state = 'pending';
		container.setAttribute('aria-busy', 'true');
		localize(title, 'easysch-workspace-loading-title', {mode}, TITLES[mode] || '正在打开工作区');
		const update = next => {
			if (disposed || owner !== revision) return;
			root.dataset.phase = next;
			localize(detail, 'easysch-workspace-loading-detail', {phase: next}, next === 'sources' ? '正在读取本次资料与对话' : '正在准备界面');
			globalLease?.update(detail.textContent);
		};
		update(phase);
		timer = win.setTimeout(() => {
			if (disposed || owner !== revision) return;
			timer = undefined;
			const progress = nativeProgress();
			if (progress) {
				globalLease = progress.begin({title: title.textContent, detail: detail.textContent, kind: 'route'});
				root.hidden = true;
				root.dataset.state = 'global';
			} else {
				root.hidden = false;
				root.dataset.state = 'visible';
			}
		}, delay);
		return {update, close() {if (owner === revision) clear();}};
	}
	function dispose() {
		if (disposed) return;
		disposed = true;
		clear();
		root.remove();
		style.remove();
	}
	return {root, begin, clear, dispose};
}
