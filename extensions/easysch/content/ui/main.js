var EasySchUI = {
	get E() { return window.arguments[0].api; },
	papers: [], current: null, record: null, selection: null, dirty: false, ready: false, busy: false,
	$: id => document.getElementById(id),
	el(tag, text, className) {
		let node = document.createElementNS('http://www.w3.org/1999/xhtml', tag);
		if (text !== undefined) node.textContent = text;
		if (className) node.className = className;
		return node;
	},
	status(message, error = false) {
		this.$('status').textContent = message;
		this.$('status').parentElement.classList.toggle('error', error);
	},
	bind(id, action) {
		this.$(id).addEventListener('click', async () => {
			try { await action(); } catch (e) { this.status(e.message, true); }
		});
	},
	projectKey() {
		return this.papers.length ? this.papers.map(this.E.core.paperKey).sort().join('|') : 'local-draft';
	},
	project() { return this.E.store.get().projects[this.projectKey()] || { title: '未命名研究', draft: '', tasks: [] }; },
	async updateProject(update) {
		let key = this.projectKey();
		await this.E.store.update(s => { let p = s.projects[key] ||= { title: '未命名研究', draft: '', tasks: [] }; update(p); });
	},
	show(tab) {
		for (let view of document.querySelectorAll('.view')) view.hidden = view.id !== 'view-' + tab;
		for (let button of document.querySelectorAll('[data-tab]')) button.classList.toggle('active', button.dataset.tab === tab);
		this.$('view-title').textContent = document.querySelector(`[data-tab="${tab}"]`).textContent;
		if (tab === 'graph') this.renderGraph();
		if (tab === 'writing') this.renderOutline();
		if (tab === 'schedule') this.renderTasks();
	},
	async refresh() {
		await this.saveDraft(false);
		let papers = this.E.library.selection();
		if (papers.length > 12) throw new Error('一次最多选择 12 篇论文，以保留足够的单篇证据上下文');
		this.papers = papers;
		this.selection = null;
		this.$('selection-box').hidden = true;
		this.current = papers[0] || null;
		this.renderPapers();
		this.loadProject();
		this.status(papers.length ? `已读取 ${papers.length} 篇论文；资料仅在触发 AI 时发送` : '未选中文献；请在 Zotero 文献列表中选择父条目或其 PDF');
	},
	async setSelection(selection) {
		if (this.busy) { this.status('分析正在进行，请完成或取消后再切换选段。'); return; }
		await this.saveDraft(false);
		this.selection = selection;
		let item = await this.E.getItem(selection.paperID);
		this.papers = [this.E.library.describe(item)];
		this.current = this.papers[0];
		this.$('selection-box').hidden = false;
		this.$('selection-text').textContent = selection.text;
		this.renderPapers(); this.loadProject(); this.show('research');
		this.status('已读取选段；点击“翻译并生成追问”发送至配置的模型');
	},
	async init() {
		for (let button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => this.show(button.dataset.tab));
		this.bind('refresh', () => this.refresh());
		this.bind('cancel', () => this.E.ai.cancel());
		this.initResearch(); this.initWriting(); this.initSettings();
		this.loadSettings();
		this.loadProject();
		if (window.arguments[0].selection) await this.setSelection(window.arguments[0].selection);
		else await this.refresh();
		window.addEventListener('beforeunload', event => {
			if (this.dirty) {
				event.preventDefault(); event.returnValue = '';
			}
		});
		this.ready = true;
	}
};
window.addEventListener('DOMContentLoaded', () => EasySchUI.init().catch(e => EasySchUI.status(e.message, true)));
