Object.assign(EasySchUI, {
	initSearch() {
		this.bind('search-academic', async () => {
			let button = this.$('search-academic'); button.disabled = true;
			this.status('正在检索学术数据库…');
			try {
				let records = await this.E.searchAcademic(this.$('search-query').value, this.$('search-source').value);
				let target = this.$('search-results'); target.replaceChildren();
				for (let record of records) {
					let card = this.el('article', undefined, 'card');
					card.append(this.el('h3', record.title), this.el('p', `${record.source} · ${record.date} · ${record.journal || ''}`, 'muted'),
						this.el('p', record.authors.map(a => [a.firstName, a.lastName].filter(Boolean).join(' ')).join(', ')), this.el('p', record.abstract || '来源未提供摘要'));
					let original = this.el('button', '查看原址'); original.addEventListener('click', () => window.parent.Zotero.launchURL(record.url));
					let add = this.el('button', '导入文库');
					add.addEventListener('click', async () => {
						add.disabled = true;
						try { let saved = await this.E.importAcademic(record); add.textContent = saved.existing ? '已在文库' : '已导入'; this.status('题录已定位到 Zotero 文库'); }
						catch (e) { add.disabled = false; this.status(e.message, true); }
					});
					card.append(original, add);
					if (record.pdf) {
						let pdf = this.el('button', '导入并下载开放 PDF');
						pdf.addEventListener('click', async () => {
							pdf.disabled = true; this.status('正在下载开放 PDF…');
							try { await this.E.importAcademicPDF(record); pdf.textContent = 'PDF 已打开'; this.status('论文已导入并打开'); }
							catch (e) { this.status(e.message, true); } finally { pdf.disabled = false; }
						}); card.append(pdf);
					}
					target.append(card);
				}
				this.status(`找到 ${records.length} 篇论文；来源为数据库实时返回，最多展示 10 篇`);
			}
			finally { button.disabled = false; }
		});
		this.$('search-query').addEventListener('keydown', event => { if (event.key === 'Enter') this.$('search-academic').click(); });
		this.bind('youdao-translate', async () => {
			this.status('正在请求有道翻译…');
			let result = await this.E.translateYoudao(this.selection?.text || this.$('prompt').value);
			this.$('translation-result').textContent = result.text;
			this.status('有道智云 · ' + this.E.formatTime(result.at));
		});
	}
});
