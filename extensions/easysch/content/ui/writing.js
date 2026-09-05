Object.assign(EasySchUI, {
	initWriting() {
		this.$('draft').addEventListener('input', () => { this.dirty = true; this.renderOutline(); });
		this.$('draft-title').addEventListener('input', () => { this.dirty = true; });
		this.bind('save-draft', () => this.saveDraft());
		this.bind('preview-draft', () => {
			let preview = this.$('draft-preview'); preview.hidden = !preview.hidden;
			if (!preview.hidden) this.renderMarkdown(preview, this.$('draft').value);
		});
		this.bind('lint', () => {
			let issues = this.E.core.lint(this.$('draft').value, this.papers.map(p => p.citeKey));
			this.$('lint-result').replaceChildren(...(issues.length ? issues : ['未发现自动检查可识别的问题，投稿前仍需人工核对。']).map(s => this.el('p', s)));
		});
		this.bind('export', async () => {
			await this.saveDraft(false);
			let folder = await this.E.pick(window, '选择导出目录（每次创建独立资料包）', 'folder');
			if (!folder) return;
			this.status('正在导出，包含引用、公式与期刊样式…');
			this.$('export').disabled = true;
			try {
				let result = await this.E.exportDocument({ folder, title: this.$('draft-title').value,
					markdown: this.$('draft').value, papers: this.papers, format: this.$('export-format').value });
				this.status(`已导出：${result.path}${result.warnings.length ? '；请查看格式检查提示' : ''}`);
				this.$('lint-result').replaceChildren(...result.warnings.map(s => this.el('p', s, 'warning')));
				let open = this.el('button', '打开导出文件所在文件夹');
				open.addEventListener('click', () => this.E.reveal(result.path)); this.$('lint-result').append(open);
			}
			finally { this.$('export').disabled = false; }
		});
		this.bind('biblatex', async () => {
			if (!this.papers.length) throw new Error('请先选择文献');
			let folder = await this.E.pick(window, '选择 BibLaTeX 导出目录', 'folder'); if (!folder) return;
			let result = await this.E.library.biblatex(this.papers);
			let path = await this.E.writeBib(folder, result.text);
			this.status(`已使用 ${result.translator} 导出 ${path}；引用键由该转换器生成`);
		});
		this.bind('add-task', async () => {
			let task = this.E.core.task(this.$('task-title').value, this.$('task-date').value);
			await this.updateProject(p => p.tasks.push(task));
			this.$('task-title').value = ''; this.renderTasks(); this.status('任务已保存');
		});
		window.addEventListener('keydown', event => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
				event.preventDefault(); this.saveDraft().catch(e => this.status(e.message, true));
			}
		});
	},
	loadProject() {
		let project = this.project();
		this.$('draft-title').value = project.title; this.$('draft').value = project.draft;
		this.dirty = false; this.renderOutline(); this.renderTasks();
		let citations = this.$('citations'); citations.replaceChildren();
		for (let paper of this.papers) {
			let button = this.el('button', `${paper.title.slice(0, 35)}\n[@${paper.citeKey}]`);
			button.addEventListener('click', () => {
				let editor = this.$('draft');
				editor.setRangeText(`[@${paper.citeKey}]`, editor.selectionStart, editor.selectionEnd, 'end');
				this.dirty = true; editor.focus();
			}); citations.append(button);
		}
	},
	async saveDraft(announce = true) {
		if (this.dirty) {
			let title = this.$('draft-title').value.trim() || '未命名研究', draft = this.$('draft').value;
			await this.updateProject(p => { p.title = title; p.draft = draft; p.updatedAt = new Date().toISOString(); });
			// Do not mark a newer edit clean while the disk write was pending.
			this.dirty = this.$('draft').value !== draft || (this.$('draft-title').value.trim() || '未命名研究') !== title;
		}
		if (announce) this.status('草稿已保存到本地；Ctrl+S 可随时保存');
	},
	renderOutline() {
		let target = this.$('outline'); target.replaceChildren();
		let markdown = this.$('draft').value;
		for (let match of markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
			let button = this.el('button', match[2]); button.style.paddingLeft = `${(match[1].length - 1) * 10 + 5}px`;
			button.addEventListener('click', () => { let editor = this.$('draft'); editor.focus(); editor.setSelectionRange(match.index, match.index + match[0].length); });
			target.append(button);
		}
	},
	renderTasks() {
		let target = this.$('tasks'); target.replaceChildren();
		let today = new Date(); let date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		let tasks = this.project().tasks.slice().sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
		for (let task of tasks) {
			let row = this.el('div', undefined, 'task' + (task.done ? ' done' : ''));
			let check = this.el('input'); check.type = 'checkbox'; check.checked = task.done; check.setAttribute('aria-label', `完成 ${task.title}`);
			check.addEventListener('change', async () => {
				try { await this.updateProject(p => { p.tasks.find(t => t.id === task.id).done = check.checked; }); this.renderTasks(); }
				catch (e) { this.status(e.message, true); }
			});
			let due = this.el('span', task.due || '未设截止日期', !task.done && task.due && task.due < date ? 'overdue' : 'muted');
			let remove = this.el('button', '删除'); remove.addEventListener('click', async () => {
				try { await this.updateProject(p => { p.tasks = p.tasks.filter(t => t.id !== task.id); }); this.renderTasks(); }
				catch (e) { this.status(e.message, true); }
			});
			row.append(check, this.el('span', task.title, 'title'), due, remove); target.append(row);
		}
		if (!tasks.length) target.append(this.el('p', '为阅读、实验或投稿设置一个下一步。', 'empty'));
	}
});
