Object.assign(EasySchUI, {
	initResearch() {
		for (let [id, mode] of [['analyze', 'analyze'], ['translate', 'translate'], ['synthesize', 'synthesize'],
			['make-outline', 'outline'], ['ask', 'ask'], ['presentation', 'presentation']]) this.bind(id, () => this.run(mode));
		this.bind('save-note', async () => {
			if (!this.record || !this.current) throw new Error('请先选择分析记录');
			await this.E.library.note(this.current, this.record); this.status('已保存为原生 Zotero 子笔记');
		});
		this.bind('apply-keywords', async () => {
			if (!this.record || !this.current) throw new Error('请先生成分析');
			await this.E.library.addTags(this.current, this.record.result.keywords);
			this.current.tags = [...new Set([...this.current.tags, ...this.record.result.keywords])];
			this.status('关键词已加入 Zotero 标签');
		});
		this.bind('to-draft', async () => {
			if (!this.record) throw new Error('请先选择分析记录');
			this.$('draft').value += '\n\n' + this.E.core.resultMarkdown(this.record);
			this.dirty = true; await this.saveDraft(); this.show('writing');
		});
		this.bind('clear-memory', async () => {
			if (!this.current) return;
			if (!window.confirm('清除此篇论文的本地 AI 历史？原生笔记与论文不会删除。')) return;
			let key = this.E.core.paperKey(this.current);
			await this.E.store.update(s => { if (s.papers[key]) s.papers[key].records = []; });
			this.renderHistory(); this.status('此篇论文的 AI 历史已清除');
		});
		this.$('history').addEventListener('change', () => {
			this.record = this.records().find(r => r.id === this.$('history').value) || null;
			this.renderResult();
		});
	},
	records() { return this.current ? this.E.store.get().papers[this.E.core.paperKey(this.current)]?.records || [] : []; },
	renderPapers() {
		let list = this.$('paper-list'); list.replaceChildren(); this.$('paper-count').textContent = this.papers.length;
		for (let paper of this.papers) {
			let button = this.el('button', undefined, 'paper' + (paper.id === this.current?.id ? ' selected' : ''));
			button.append(this.el('strong', paper.title), this.el('small', `${paper.authors || '作者未录入'} · ${paper.year || '年份未知'}`));
			button.addEventListener('click', () => { if (!this.busy) { this.current = paper; this.renderPapers(); } }); list.append(button);
		}
		let details = this.$('paper-details'); details.replaceChildren();
		if (this.current) {
			let p = this.current;
			let metric = this.E.store.get().papers[this.E.core.paperKey(p)]?.metric;
			details.append(this.el('h2', p.title), this.el('p', p.authors || '作者信息未录入', 'muted'),
				this.el('p', `${p.journal || '期刊未录入'} · ${p.year || '年份未知'} · DOI ${p.doi || '未录入'}`, 'muted'),
				this.el('small', metric ? `影响因子 ${metric.value}（${metric.year}，人工记录）` : '影响因子：未核验', 'muted'));
		}
		this.renderHistory(); this.loadMetric();
	},
	renderHistory() {
		let history = this.$('history'); history.replaceChildren();
		let records = this.records().slice().reverse();
		for (let record of records) {
			let option = this.el('option', `${new Date(record.at).toLocaleString()} · ${record.mode}`);
			option.value = record.id; history.append(option);
		}
		if (!records.length) history.append(this.el('option', '尚无记录'));
		this.record = records[0] || null; this.renderResult();
	},
	renderResult() {
		let target = this.$('result'); target.replaceChildren(); this.$('questions').replaceChildren();
		target.className = this.record ? '' : 'empty';
		if (!this.record) { target.textContent = '选择一篇论文，开始建立可追溯的研究笔记。'; return; }
		for (let warning of this.record.warnings) target.append(this.el('p', warning, 'warning'));
		for (let section of this.record.result.sections) {
			let block = this.el('section', undefined, 'result-section');
			let body = this.el('div', undefined, 'markdown-preview');
			this.renderMarkdown(body, section.body);
			block.append(this.el('h3', section.heading), body);
			for (let id of section.sources) {
				let source = this.record.sources.find(s => s.id === id);
				if (!source) continue;
				let link = this.el('button', `${id} · ${source.label}`, 'evidence');
				link.title = source.text.slice(0, 900);
				link.addEventListener('click', () => this.E.library.openSource(source).catch(e => this.status(e.message, true)));
				block.append(link);
			}
			if (!section.sources.length) block.append(this.el('p', '待验证推断：未附原文证据。', 'warning'));
			target.append(block);
		}
		for (let question of this.record.result.questions) {
			let button = this.el('button', question);
			button.addEventListener('click', () => { this.$('prompt').value = question; this.run('ask').catch(e => this.status(e.message, true)); });
			this.$('questions').append(button);
		}
	},
	async run(mode) {
		if (this.busy) throw new Error('已有分析进行中，请等待或取消');
		if (!this.current) throw new Error('请先读取选中文献');
		if (mode === 'translate' && !this.selection) throw new Error('请先在 PDF 阅读器中选择文字');
		if (mode === 'ask' && !this.$('prompt').value.trim()) throw new Error('请输入研究问题');
		let papers = ['synthesize', 'presentation', 'outline'].includes(mode) ? [...this.papers] : [this.current];
		if (mode === 'synthesize' && papers.length < 2) throw new Error('联合研究至少需要两篇文献');
		let prompt = this.$('prompt').value;
		if (mode === 'presentation') {
			let parts = [...document.querySelectorAll('[name="slide-part"]:checked')].map(n => n.value);
			if (!parts.length) throw new Error('请至少选择一项演示内容');
			prompt += '\n演示内容范围：' + parts.join('、');
		}
		this.$('cancel').hidden = false;
		this.busy = true;
		let actions = ['analyze', 'translate', 'synthesize', 'make-outline', 'ask', 'presentation', 'refresh', 'clear-memory'];
		for (let id of actions) this.$(id).disabled = true;
		try {
			let record = await this.E.ai.run({ mode, papers, prompt, selection: this.selection,
				onStatus: s => this.status(s) });
			this.renderHistory(); this.record = record; this.renderResult();
			this.status('分析已保存。请逐项核对原文证据；可追加到写作草稿后导出。');
		}
		finally { this.busy = false; this.$('cancel').hidden = true; for (let id of actions) this.$(id).disabled = false; }
	},
	renderGraph() {
		let target = this.$('graph'); target.replaceChildren(); this.$('graph-edges').replaceChildren();
		let { nodes, edges } = this.E.core.graph(this.papers);
		if (!nodes.length) { target.append(this.el('p', '请先读取 Zotero 选中文献。', 'empty')); return; }
		let svgNS = 'http://www.w3.org/2000/svg';
		let make = (tag, attrs) => { let n = document.createElementNS(svgNS, tag); for (let [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
		let svg = make('svg', { viewBox: '0 0 860 470', role: 'img', 'aria-label': '选中文献的标签与相关条目网络' });
		let points = new Map(nodes.map((node, i) => [node.id, { x: 430 + 285 * Math.cos(i / nodes.length * Math.PI * 2), y: 235 + 155 * Math.sin(i / nodes.length * Math.PI * 2) }]));
		for (let edge of edges) {
			let a = points.get(edge.from), b = points.get(edge.to);
			svg.append(make('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'graph-edge' }));
			let from = nodes.find(n => n.id === edge.from), to = nodes.find(n => n.id === edge.to);
			this.$('graph-edges').append(this.el('p', `${from.title} ↔ ${to.title}：${edge.label}`));
		}
		for (let node of nodes) {
			let p = points.get(node.id);
			let group = make('g', { class: 'graph-node', tabindex: '0', role: 'button', 'aria-label': node.title });
			let title = make('title', {}); title.textContent = node.title;
			let label = make('text', { x: p.x, y: p.y + 42, 'text-anchor': 'middle' }); label.textContent = node.title.slice(0, 21) + (node.title.length > 21 ? '…' : '');
			let initial = make('text', { x: p.x, y: p.y + 4, 'text-anchor': 'middle' }); initial.textContent = nodes.indexOf(node) + 1;
			group.append(title, make('circle', { cx: p.x, cy: p.y, r: 24 }), initial, label);
			let open = () => { if (!this.busy) { this.current = node; this.renderPapers(); this.show('research'); } };
			group.addEventListener('click', open); group.addEventListener('keydown', e => { if (e.key === 'Enter') open(); }); svg.append(group);
		}
		target.append(svg);
		if (!edges.length) this.$('graph-edges').textContent = '当前文献没有共享标签或显式关联，可在 Zotero 中添加标签和相关条目。';
	}
});
