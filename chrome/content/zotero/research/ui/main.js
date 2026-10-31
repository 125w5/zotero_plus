var EasySchUI = {
	get E() { return window.parent.Zotero.Research; },
	papers: [], current: null, record: null, selection: null, dirty: false, ready: false, busy: false, legacyJob: null,
	$: id => document.getElementById(id),
	// Legacy E.ai.run jobs started from this page pass this signal, so 取消 here
	// and closing this page stop only this page's job.
	legacyJobSignal() {
		this.legacyJob = new AbortController();
		return this.legacyJob.signal;
	},
	cancelLegacyJob() {
		this.legacyJob?.abort();
		this.legacyJob = null;
	},
	el(tag, text, className) {
		let node = document.createElementNS('http://www.w3.org/1999/xhtml', tag);
		if (text !== undefined) node.textContent = text;
		if (className) node.className = className;
		return node;
	},
	status(message, error = false) {
		this.$('status').textContent = message;
		this.$('status').parentElement.classList.toggle('error', error);
		let dismiss = this.$('dismiss-status');
		if (dismiss) dismiss.hidden = !error;
	},
	// A button stays disabled while any job holds it, so a job that ends first
	// does not free a button another running job still holds.
	buttonHolds: new WeakMap(),
	holdButton(button) {
		this.buttonHolds.set(button, (this.buttonHolds.get(button) || 0) + 1);
		button.disabled = true;
	},
	releaseButton(button) {
		let count = (this.buttonHolds.get(button) || 1) - 1;
		if (count) {
			this.buttonHolds.set(button, count);
			return;
		}
		this.buttonHolds.delete(button);
		button.disabled = false;
	},
	// As on the settings page: the clicked button is disabled and aria-busy until
	// its job succeeds, fails or is cancelled, and a second click starts nothing.
	bind(id, action) {
		let button = this.$(id), running = false;
		button.addEventListener('click', async () => {
			if (running || button.disabled) return;
			running = true;
			this.holdButton(button);
			button.setAttribute('aria-busy', 'true');
			try { await action(); } catch (e) { this.status(e.message, true); }
			finally {
				running = false;
				this.releaseButton(button);
				button.setAttribute('aria-busy', 'false');
			}
		});
	},
	projectKey() {
		return this.papers.length ? this.papers.map(this.E.core.paperKey).sort().join('|') : 'local-draft';
	},
	project() { return { title: '未命名研究', draft: '', tasks: [], ...this.E.store.get().projects[this.projectKey()] }; },
	async updateProject(update) {
		let key = this.projectKey();
		await this.E.store.update(s => { let p = s.projects[key] ||= { title: '未命名研究', draft: '', tasks: [] }; update(p); });
	},
	show(tab) {
		if (tab === 'home' || tab === 'discovery') tab = 'search';
		if (this.activeView === 'search' && tab !== 'search') this.suspendDiscovery?.();
		if (this.activeView !== tab) this.status('');
		this.setProjectCreateVisible?.(tab === 'writing');
		this.activeView = tab;
		for (let view of document.querySelectorAll('.view')) view.hidden = view.id !== 'view-' + tab;
		for (let button of document.querySelectorAll('[data-tab]')) button.classList.toggle('active', button.dataset.tab === (tab==='journal'?'settings':tab));
		this.$('view-title').textContent = tab==='journal'?'设置':document.querySelector(`[data-tab="${tab}"]`)?.textContent||'工作台';
		if (tab === 'graph') this.renderGraph();
		if (tab === 'writing') {
			this.renderOutline();
			// A native workflow dialog retains an unfinished create form when
			// switching to PPT and back, or when it is temporarily dismissed.
			if (!window.frameElement?.researchOverlayMode || !this.$('manuscript-projects')?.querySelector('.project-create')) this.renderManuscriptProjects?.();
		}
		if (tab === 'schedule') this.renderTasks();
		if (tab === 'search') this.prepareDiscovery();
		this.renderSurfaceSteps?.();
	},
	async refresh() {
		await this.saveDraft(false);
		let papers = this.E.library.selection();
		papers = (await Promise.all(papers.map(async p => await this.E.library.localPDF(p.id) ? p : null))).filter(Boolean);
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
		this.$('selection-box').hidden = !selection.text;
		this.$('selection-text').textContent = selection.text;
		this.renderPapers(); this.loadProject();
		if (this.openAgentWorkbench) { this.openAgentWorkbench(); this.previewAgentSource({ ...this.current, kind: 'paper', stableID: 'paper:' + this.current.id, selection }); }
		else this.show('research');
		this.status(selection.text ? '已定位选段，可继续讨论或翻译。' : '已选中论文，可讨论研究问题。');
	},
	init() {
		if (this.ready) return this.openInitialSelection();
		if (this.initPromise) return this.initPromise;
		this.initPromise = this.initialize();
		return this.initPromise;
	},
	async openInitialSelection() {
		if (window.frameElement?.researchPage) {
			const page=window.frameElement.researchPage;
			if(page==='ppt')await this.openPPTStudio({newDraft:true});
			else if(page==='agent')this.openAgentWorkbench();
			else this.show(page);
			if(window.frameElement.researchCreateProject)this.$('new-manuscript')?.click();
			return;
		}
		if (window.frameElement?.researchLibraryMode) {
			document.body.classList.add('library-discovery');this.current=this.E.library.selection()[0]||null;
			const requested=window.frameElement.researchLibraryView||'discovery';
			if(requested==='agent')this.openAgentWorkbench();else if(requested!=='local')this.show(requested);
			return;
		}
		if (window.frameElement?.researchOverlayMode) { document.body.classList.add('workflow-overlay-content');this.current=this.E.library.selection()[0]||null;this.show('writing');return; }
		const initialSelection = window.frameElement?.researchSelection;
		if (window.frameElement) window.frameElement.researchSelection = null;
		if (initialSelection) await this.setSelection(initialSelection);
		else { await this.refresh(); this.openAgentWorkbench(); }
	},
	async initialize() {
		if(window.frameElement?.researchLibraryMode){document.body.classList.add('library-discovery','library-embedded');document.body.dataset.libraryView=window.frameElement.researchLibraryView||'discovery';}
		for (let button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
			const tab = button.dataset.tab;
			if (['writing', 'ppt'].includes(tab) && !window.frameElement?.researchOverlayMode) {
				this.E.openWorkflow(tab).catch(error => this.status(error.message, true));
				return;
			}
			this.show(tab);
		});
		this.bind('refresh', () => this.refresh());
		this.bind('cancel', () => this.cancelLegacyJob());
		this.bind('dismiss-status', () => this.status(''));
		this.initResearch(); this.initWriting(); this.initSettings(); this.initMeetings(); this.initSearch(); this.initPaperSkills();
		this.initPPTStudio(); this.initFlow();this.initDiscovery();this.initKnowledge();this.initWritingCards(); await this.initTasks();
		this.initManuscriptProjects();await this.initSurface();
		await this.initAgentWorkbench();
		this.initReadingWorkbench();
		this.loadSettings();
		this.loadProject();
		await this.openInitialSelection();
		window.addEventListener('beforeunload', event => {
			if (this.dirty) {
				event.preventDefault(); event.returnValue = '';
			}
		});
		window.addEventListener('pagehide', () => this.cancelLegacyJob());
		this.ready = true;
	}
};
window.addEventListener('DOMContentLoaded', event => { if (event.target === document) EasySchUI.init().catch(e => EasySchUI.status(e.message, true)); });
