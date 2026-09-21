/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
	previewResearchNote() {
		const record = this.record,
			paper = this.current,
			box = this.el('section', undefined, 'card');
		box.id = 'research-note-preview';
		this.$('research-note-preview')?.remove();
		box.append(
			this.el('h3', '确认笔记内容'),
			this.el(
				'p',
				'以下内容将新增到论文下的 Zotero 笔记。已有笔记不会被覆盖。只有 PDF 精确划选才会同步创建高亮。',
			),
		);
		const preview = this.el('div');
		this.renderMarkdown(preview, this.E.core.resultMarkdown(record));
		box.append(preview);
		this.pptButton(
			'确认保存为 Zotero 笔记',
			async () => {
				const id = await this.E.library.note(paper, record),
					note = await this.E.getItem(id),
					original = note.getNote();
				box.replaceChildren(this.el('p', '已保存，笔记中的来源可回到原文。'));
				this.pptButton(
					'撤销新增笔记',
					async () => {
						const n = await this.E.getItem(id);
						if (n.getNote() !== original)
							throw Error('笔记已经修改，请到文库中检查后删除');
						await window.parent.Zotero.Items.trashTx([id]);
						box.remove();
					},
					box,
				);
			},
			box,
		);
		this.pptButton('取消', () => box.remove(), box);
		this.$('result').prepend(box);
		box.scrollIntoView({ block: 'nearest' });
	},
 updateReadingActions() {
  const hasPaper=!!this.current,hasText=!!this.$('prompt').value.trim(),selection=!!this.selection?.text,ready=!!this.record;
  const main=this.$('analyze'),save=this.$('save-note');
  main.textContent=!hasPaper?'选择论文并阅读':hasText?(selection?'回答选段问题':'回答这个问题'):(selection?'解释选段':'读懂这篇论文');
  main.classList.toggle('primary',!ready||hasText||selection);save.hidden=!ready;save.classList.toggle('primary',ready&&!hasText&&!selection);
  this.$('research-choose-papers').hidden=!hasPaper;
 },
 initFlow() {
		const fold = (parent, label, ids) => {
			const box = this.el('details');
			box.className = 'flow-more';
			box.append(this.el('summary', label));
			for (const id of ids) {
				const n = this.$(id);
				if (n) box.append(n);
			}
			parent.append(box);
			return box;
		};
		const research = this.$('view-research'),
			column = research.querySelector('.analysis-column');
		this.$('analyze').textContent = '开始阅读这篇论文';
		this.$('save-note').textContent = '预览并保存笔记';
		const skill = this.$('paper-skill').closest('.card'),
			advanced = fold(column, '更多阅读工具', [
				'synthesize',
				'make-outline',
				'ask',
				'youdao-translate',
				'apply-keywords',
				'to-draft',
				'clear-memory',
			]);
		advanced.append(skill, this.$('refresh'));
		const original=this.$('analyze'), action=original.cloneNode(true);original.replaceWith(action);action.onclick=async()=>{try{if(!this.current){this.readAfterChoosing=true;await this.chooseResearchPapers();return;}await this.run(this.$('prompt').value.trim()?'ask':'analyze');}catch(e){this.status(e.message,true);}};
		this.$('prompt').addEventListener('input',()=>this.updateReadingActions());
		const options = research.querySelector('.presentation-options');
		if (options) advanced.append(options);
		const home = research.querySelector('.ppt-home');
		if (home) advanced.append(home);
		this.pptButton(
			'智能整理标签',
			() => this.showOrganize().catch((e) => this.status(e.message, true)),
			advanced,
		);
		const choose = this.el('button', '选择论文');
		choose.id = 'research-choose-papers';
		choose.onclick = () =>
			this.chooseResearchPapers().catch((e) => this.status(e.message, true));
		research.querySelector('.library-column').prepend(choose);
		column.prepend(
			this.el(
				'p',
				'选择论文后直接阅读；也可输入问题，或在 PDF 中选中文字进行解释。',
				'flow-guide',
			),
		);
		fold(this.$('view-writing'), '导出与格式检查', [
			'preview-draft',
			'lint',
			'export-format',
			'export',
			'biblatex',
		]);
		const settings = this.$('view-settings');
		for (const card of [...settings.querySelectorAll(':scope > .card')])
			fold(
				settings,
				card.querySelector('h2')?.textContent || '更多服务',
				[],
			).append(card);
		fold(settings, '高级提示词与维护', ['template', 'forget-key']);
		settings.querySelector('label[for="template"]')?.remove();
		const journal = this.el('section');
		journal.id = 'view-journal';
		journal.className = 'view';
		journal.hidden = true;
		document.querySelector('main').append(journal);
		journal.append(settings.querySelector('.settings-grid>div:last-child'));
		const metricCard = this.$('metrics-key').closest('.flow-more');
		if (metricCard) journal.append(metricCard);
		journal.append(this.$('save-metric'));
		this.pptButton(
			'保存期刊与格式设置',
			() => this.$('save-settings').click(),
			journal,
			'primary',
		);
		const journalNav = this.el('button', '期刊与格式');
		journalNav.dataset.tab = 'journal';
		journalNav.onclick = () => this.show('journal');
		document.querySelector('[data-tab="settings"]').after(journalNav);
		document.querySelector('[data-tab="settings"]').textContent = '模型与翻译';
		research
			.querySelector('.library-column .muted')
			?.replaceChildren(
				document.createTextNode(
					'点击“选择论文”从文库勾选；也可读取 Zotero 中已选中的条目。',
				),
			);
		const meeting = this.$('view-meetings'),
			create = this.el('button', '新建组会汇报');
		create.className = 'primary';
		create.id = 'flow-new-meeting';
		create.onclick = () => this.openPPTStudio({ newDraft: true });
		meeting.prepend(
			create,
			this.el('p', '先用向导准备汇报；需要追问训练时，再展开导师讨论。'),
		);
		for (const card of [...meeting.querySelectorAll(':scope > .card')])
			fold(
				meeting,
				card.querySelector('h2')?.textContent || '组会记录',
				[],
			).append(card);
	},
 async chooseResearchPapers() {
  if (this.$('research-paper-picker')) return;
  const box=this.el('dialog',undefined,'paper-picker');box.id='research-paper-picker';
  const heading=this.el('h2','选择已下载的论文'),search=this.el('input'),rows=this.el('div',undefined,'picker-rows'),bar=this.el('div',undefined,'picker-actions'),selectionBar=this.el('div',undefined,'selection-toolbar'),count=this.el('span','正在读取本地附件…');
  heading.id='research-paper-picker-title';box.setAttribute('aria-labelledby',heading.id);count.setAttribute('role','status');
  search.placeholder='搜索标题、作者或年份';search.setAttribute('aria-label',search.placeholder);rows.tabIndex=0;rows.setAttribute('aria-label','论文列表，Ctrl+A 全选当前结果');
  const chosen=new Map(this.papers.map(p=>[p.id,p]));let papers=[],matches=[],composing=false;
  const render=()=>{matches=papers.filter(p=>(p.title+' '+p.authors+' '+p.year).normalize('NFKC').toLowerCase().includes(search.value.normalize('NFKC').trim().toLowerCase()));rows.replaceChildren();
   count.textContent=`已选 ${chosen.size} 篇 · ${matches.length} 篇可阅读 · 每次最多分析 12 篇`;
   for(const p of matches){const label=this.el('label',undefined,'picker-row'),check=this.el('input');check.type='checkbox';check.checked=chosen.has(p.id);check.dataset.paperId=p.id;label.classList.toggle('selected',check.checked);label.append(check,this.el('span',p.title));check.onchange=()=>{if(check.checked)chosen.set(p.id,p);else chosen.delete(p.id);count.textContent=`已选 ${chosen.size} 篇 · ${matches.length} 篇可阅读 · 每次最多分析 12 篇`;label.classList.toggle('selected',check.checked);};rows.append(label);}allCheck.checked=matches.length>0&&matches.every(p=>chosen.has(p.id));allCheck.indeterminate=chosen.size>0&&!allCheck.checked;
   if(!matches.length)rows.append(this.el('p',papers.length?'没有匹配的论文，请尝试其他关键词。':'没有可打开的本地 PDF。仅有题录的论文请先在文献搜集中获取附件。','empty'));
  };
  const selectAll=()=>{for(const p of matches)chosen.set(p.id,p);render();};
  const allLabel=this.el('label',undefined,'compact-check'),allCheck=this.el('input');allCheck.type='checkbox';allCheck.onchange=()=>{if(allCheck.checked)selectAll();else{chosen.clear();render();}};allLabel.append(allCheck,document.createTextNode('全选'));selectionBar.append(allLabel,count);
  rows.onkeydown=e=>{if(!e.isComposing&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();selectAll();}};
  search.addEventListener('compositionstart',()=>composing=true);search.addEventListener('compositionend',()=>{composing=false;render();});search.oninput=()=>{if(!composing)render();};
  const pickerHeader=this.el('div',undefined,'picker-heading');pickerHeader.append(heading,selectionBar);box.append(pickerHeader,search,rows,bar);document.body.append(box);box.onclose=()=>{this.readAfterChoosing=false;box.remove();};
  this.pptButton('开始阅读',async()=>{if(!chosen.size||chosen.size>12){count.textContent='请选择 1–12 篇论文；更多论文可分批阅读。';return;}
   await this.saveDraft(false);this.papers=[...chosen.values()];this.current=this.papers[0];this.selection=null;this.renderPapers();this.loadProject();const run=this.readAfterChoosing;box.close();this.status(`已选择 ${this.papers.length} 篇论文`);if(run)await this.run(this.$('prompt').value.trim()?'ask':'analyze');
  },bar,'primary');this.pptButton('取消',()=>box.close(),bar);box.showModal();search.focus();
  try{papers=await this.E.library.readingCandidates();const valid=new Set(papers.map(p=>p.id));for(const id of chosen.keys())if(!valid.has(id))chosen.delete(id);render();}catch(e){count.textContent='文库读取失败：'+e.message;}
 },
	showHelp() {
		const box = this.el('details');
		box.open = true;
		box.append(
			this.el('summary', '第一次使用：从一篇论文开始'),
			this.el(
				'p',
				'导入 PDF → 选择论文 → AI 阅读 → 核对证据 → 保存笔记。PDF 划选文字可保存带高亮的 AI 笔记；写作和组会使用这些证据。研究日常用于记录下一步任务。',
			),
		);
		this.$('view-research').prepend(box);
	},
	async showOrganize() {
		if (!this.current) {
			await this.chooseResearchPapers();
			this.status('先选择论文，再打开更多中的智能整理。');
			return;
		}
		const paper = this.current;
		if (this.busy) throw Error('已有分析进行中，请先等待或取消');
		this.busy = true;
		this.$('cancel').hidden = false;
		this.status('正在建议标签…');
		const record = await this.E.ai
				.run({
					mode: 'analyze',
					papers: [paper],
					onStatus: (s) => this.status(s),
				})
				.finally(() => {
					this.busy = false;
					this.$('cancel').hidden = true;
				}),
			box = this.el('section');
		box.className = 'card';
		box.append(this.el('h3', '核对标签建议后再保存'));
		const choices = [];
		for (const tag of record.result.keywords || []) {
			const l = this.el('label'),
				c = this.el('input');
			c.type = 'checkbox';
			c.checked = true;
			l.append(c, this.el('span', tag));
			box.append(l);
			choices.push({ c, tag });
		}
		this.pptButton(
			'保存选中标签',
			async () => {
				const item = await this.E.getItem(paper.id),
					before = item.getTags().map((t) => t.tag),
					tags = choices.filter((x) => x.c.checked).map((x) => x.tag);
				await this.E.library.addTags(paper, tags);
				this.status('标签已保存');
				this.pptButton(
					'撤销新增标签',
					async () => {
						for (const tag of tags.filter((t) => !before.includes(t)))
							item.removeTag(tag);
						await item.saveTx();
						box.remove();
					},
					box,
				);
			},
			box,
		);
		this.$('result').prepend(box);
	},
});
