Object.assign(EasySchUI, {
	showPaperActions(paper, anchor) {
		this.$('reading-paper-menu')?.remove();const menu=this.el('div',undefined,'reading-paper-menu');menu.id='reading-paper-menu';menu.setAttribute('role','menu');
		const rect=anchor.getBoundingClientRect();menu.style.cssText=`position:fixed;left:${Math.min(rect.left,innerWidth-220)}px;top:${Math.min(rect.bottom,innerHeight-120)}px;z-index:100;background:var(--panel,#fff);color:var(--text,#222);border:1px solid var(--line,#ccc);border-radius:10px;padding:8px;box-shadow:0 6px 22px #0002`;
		const add=(label,fn)=>{const button=this.el('button',label);button.setAttribute('role','menuitem');button.style.display='block';button.style.width='100%';button.onclick=async()=>{menu.remove();try{await fn();}catch(e){this.status(e.message,true);}};menu.append(button);};
		add('打开 PDF',async()=>{const pdf=await this.E.library.localPDF(paper.id);if(pdf)await this.E.library.openSource({attachmentID:pdf.id});});add('在文件夹中显示',()=>this.E.library.revealPDF(paper.id));add('关闭菜单',()=>{});document.body.append(menu);menu.querySelector('button').focus();menu.onkeydown=e=>{if(e.key==='Escape'){menu.remove();anchor.focus();}};
		setTimeout(()=>document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))menu.remove();},{once:true}),0);
	},
	initResearch() {
		for (let [id, mode] of [['analyze', 'analyze'], ['translate', 'translate'], ['synthesize', 'synthesize'],
			['make-outline', 'outline'], ['ask', 'ask'], ['presentation', 'presentation']]) this.bind(id, () => this.run(mode));
		this.bind('save-note', async () => {
			if (!this.record || !this.current) throw new Error('请先选择分析记录');
			this.previewResearchNote();
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
			let button = this.el('button', undefined, 'reading-paper' + (paper.id === this.current?.id ? ' selected' : ''));
			button.append(this.el('strong', paper.title), this.el('small', `${paper.authors || '作者未录入'} · ${paper.year || '年份未知'}`));
			button.addEventListener('click', () => { if (!this.busy) { this.current = paper; this.selection=null; this.$('selection-box').hidden=true;this.renderPapers(); } }); button.ondblclick=async()=>{const pdf=await this.E.library.localPDF(paper.id);if(pdf)await this.E.library.openSource({attachmentID:pdf.id});}; button.oncontextmenu=e=>{e.preventDefault();this.showPaperActions?.(paper,button);}; list.append(button);
		}
		let details = this.$('paper-details');for(const child of details.children)child._overviewOff?.();details.replaceChildren();
		if (this.current) {
			let p = this.current;
			const overview=this.el('div');details.append(overview);this.E.renderPaperOverview(overview,this.E.getCachedItem(p.id),{abstract:true});
			let metric = this.E.metrics.get(this.E.issn(this.E.getCachedItem(p.id)))?.[0];
			details.append(this.el('h2', p.title), this.el('p', p.authors || '作者信息未录入', 'muted'),
				this.el('p', [p.journal,p.year,p.doi&&'DOI '+p.doi].filter(Boolean).join(' · '), 'muted'));
			if(metric?.impact_factor!=null)details.append(this.el('small',`影响因子 ${metric.impact_factor}（${metric.metric_year}，${metric.source}）`,'muted'));
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
		this.renderSurfaceSteps?.();
		if(this.$('research-choose-papers'))this.updateReadingActions?.();
		let target = this.$('result'); target.replaceChildren(); this.$('questions').replaceChildren();
		target.className = this.record ? '' : 'empty';
		if (!this.record) { target.textContent = '选择一篇论文，开始建立可追溯的研究笔记。'; return; }
		for (let warning of this.record.warnings) target.append(this.el('p', warning, 'warning'));
		for (let section of this.record.result.sections) {
			let block = this.el('section', undefined, 'result-section');
			let body = this.el('div', undefined, 'markdown-preview');
			this.renderMarkdown(body, section.body);
			block.append(this.el('h3', section.heading), body);
			if (section.claim_type) block.prepend(this.el('small', { author_claim: '作者主张', observation: '原文观察', inference: 'AI 推断', insufficient_evidence: '证据不足' }[section.claim_type] + ' · 论断尚需核验', 'muted'));
			if (section.quotes?.length) {
				let quotes = this.el('details'); quotes.append(this.el('summary', '查看已匹配原文的逐字证据'));
				for (let quote of section.quotes) quotes.append(this.el('blockquote', quote.text), this.el('small', quote.source_id));
				block.append(quotes);
			}
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
		let papers = (['synthesize', 'presentation', 'outline'].includes(mode) || this.E.paperSkills[mode]?.multi) ? [...this.papers] : [this.current];
		if (['synthesize', 'comparison'].includes(mode) && papers.length < 2) throw new Error('联合研究至少需要两篇文献');
		let prompt = this.$('prompt').value;
		if (mode === 'presentation') {
			let parts = [...document.querySelectorAll('[name="slide-part"]:checked')].map(n => n.value);
			if (!parts.length) throw new Error('请至少选择一项演示内容');
			prompt += '\n演示内容范围：' + parts.join('、');
		}
		this.$('cancel').hidden = false;
		this.busy = true;
		let actions = ['analyze', 'translate', 'synthesize', 'make-outline', 'ask', 'presentation', 'refresh', 'clear-memory', 'run-paper-skill'];
		for (let id of actions) this.$(id).disabled = true;
		try {
			let record = await this.E.ai.run({ mode, papers, prompt, selection: this.selection,
				onStatus: s => this.status(s) });
			this.renderHistory(); this.record = record; this.renderResult();
			this.status('分析已保存。请逐项核对原文证据；可追加到写作草稿后导出。');
		}
		finally { this.busy = false; this.$('cancel').hidden = true; for (let id of actions) this.$(id).disabled = false; }
	},
});
