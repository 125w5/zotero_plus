/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
	meetingID: null,
	initMeetings() {
		let nav = this.el('button', '组会与导师模式'); nav.dataset.tab = 'meetings';
		nav.addEventListener('click', () => this.show('meetings'));
		document.querySelector('nav').append(nav);

		this.refreshMeetingList();
		this.$('meeting-list').addEventListener('change', () => { this.meetingID = this.$('meeting-list').value || null; this.loadMeeting(); });
		this.bind('meeting-save', async () => {
			let previous = this.E.meetings.all()[this.meetingID];
			let data = { id: this.meetingID, paperIDs: previous?.paperIDs || this.papers.map(p => p.id) };
			for (let key of ['title', 'date', 'type', 'minutes', 'topic', 'advisor']) data[key] = this.$('meeting-' + key).value;
			if (previous?.date?.length === 10 && data.date === previous.date + 'T00:00') data.date = previous.date;
			this.meetingID = await this.E.meetings.save(data); this.refreshMeetingList(); this.status('组会已保存');
		});
		this.bind('meeting-outline', () => this.runMeeting(async () => { await this.E.meetings.outline(this.requireMeeting(), text => this.status(text)); }));
		this.bind('meeting-ask', () => this.runMeeting(async () => {
			await this.E.meetings.ask(this.requireMeeting(), this.$('meeting-answer').value, text => this.status(text));
			this.$('meeting-answer').value = '';
		}));
		this.bind('meeting-layout', () => this.runMeeting(async () => {
			let m = this.E.meetings.all()[this.requireMeeting()];
			if (!m.outline) throw new Error('请先生成组会大纲');
			await this.E.planPresentation(m, text => this.status(text));
		}));
		this.bind('meeting-data', async () => {
			let id = this.requireMeeting();
			let file = await this.E.pick(window, '选择图表数据 JSON', 'file', 'json');
			if (!file) return;
			let data = await this.E.readChartData(file);
			await this.E.store.update(s => { s.meetings[id].datasets = data; delete s.meetings[id].slidePlan; });
			this.loadMeeting();
			this.status('已导入数据；重新规划页面后可生成数据图');
		});
		this.bind('meeting-export', () => this.runMeeting(async () => {
			let m = this.E.meetings.all()[this.requireMeeting()];
			if (!m.outline || !this.$('meeting-approved').checked) throw new Error('先生成并核对大纲和引用来源');
			let folder = await this.E.pick(window, '选择 PPTX 导出目录', 'folder');
			if (!folder) return;
			let edited = this.$('meeting-slide-plan').value.trim();
			let plan = edited ? JSON.parse(edited) : null;
			let output = await this.E.runArtifactEngine({ operation: 'export', directory: folder, title: m.title, record: m.outline, plan, datasets: m.datasets || [] }, text => this.status(text));
			await this.E.store.update(s => { s.meetings[m.id].lastArtifact = output; if (plan) s.meetings[m.id].slidePlan = plan; });
			await this.E.reveal(output.path);
			return 'PPTX 与图形已导出；请逐页核对排版和证据。';
		}));
		this.bind('meeting-add-task', async () => { await this.E.meetings.task(this.requireMeeting(), this.$('meeting-task').value); this.$('meeting-task').value = ''; this.loadMeeting(); });
	},
	requireMeeting() { if (!this.meetingID) throw new Error('请先保存或选择组会'); return this.meetingID; },
	async runMeeting(action) {
		if (this.busy) throw new Error('请等待当前分析完成');
		this.busy = true;
		try { let message = await action(); this.loadMeeting(); this.status(message || '已保存，请核对原文'); }
		finally { this.busy = false; }
	},
	refreshMeetingList() {
		let list = this.$('meeting-list'); list.replaceChildren(this.el('option', '新建组会')); list.firstChild.value = '';
		for (let m of Object.values(this.E.meetings.all())) { let o = this.el('option', `${m.date || '未排期'} · ${m.title}`); o.value = m.id; list.append(o); }
		list.value = this.meetingID || '';
	},
	loadMeeting() {
		let m = this.E.meetings.all()[this.meetingID];
		for (let key of ['title', 'date', 'type', 'minutes', 'topic', 'advisor']) this.$('meeting-' + key).value = m?.[key] || (key === 'minutes' ? '15' : '');
		if (m?.date?.length === 10) this.$('meeting-date').value = m.date + 'T00:00';
		this.$('meeting-date').title = m?.date?.length === 10 ? '原记录仅有日期；补充时间后保存' : '';
		this.$('meeting-approved').checked = false;
		this.$('meeting-slide-plan').value = m?.slidePlan ? JSON.stringify(m.slidePlan, null, 2) : '';
		this.$('meeting-plan').replaceChildren();
		if (m?.outline) this.renderMarkdown(this.$('meeting-plan'), this.E.core.resultMarkdown(m.outline));
		if (m?.slidePlan) {
			let preview = this.el('div'); preview.append(this.el('h3', '待导出页面'));
			for (let [index, slide] of m.slidePlan.slides.entries()) {
				preview.append(this.el('h4', `${index + 1}. ${slide.title}`));
				let description = slide.kind === 'diagram' ? (slide.nodes || []).map(n => n.label).join(' · ')
					: slide.kind === 'chart' ? `数据集：${slide.datasetID}` : (slide.bullets || []).join('\n');
				preview.append(this.el('p', description));
				preview.append(this.el('small', `证据：${(slide.sources || []).join('、')} · ${slide.kind}`));
			}
			this.$('meeting-plan').prepend(preview);
		}
		let turns = this.$('meeting-turns'); turns.replaceChildren();
		for (let t of m?.turns || []) {
			turns.append(this.el('p', `你的回答：${t.answer || '开始训练'}`));
			let output = this.el('div'); this.renderMarkdown(output, this.E.core.resultMarkdown(t.record)); turns.append(output);
		}
		let tasks = this.$('meeting-tasks'); tasks.replaceChildren();
		for (let task of m?.tasks || []) {
			let label = this.el('label', task.text), check = this.el('input'); check.type = 'checkbox'; check.checked = task.done;
			let meetingID = m.id;
			check.addEventListener('change', () => this.E.store.update(s => { s.meetings[meetingID].tasks.find(t => t.id === task.id).done = check.checked; }).catch(e => this.status(e.message, true)));
			label.prepend(check); tasks.append(label);
		}
	}
});
