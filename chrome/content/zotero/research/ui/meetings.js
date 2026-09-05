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
		this.bind('meeting-preview', () => {
			let plan = JSON.parse(this.$('meeting-slide-plan').value);
			this.renderMeetingPreview(plan, this.E.meetings.all()[this.requireMeeting()]);
			this.status('已按当前 JSON 刷新预览；导出前仍需勾选人工核对');
		});
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
		if (m?.slidePlan) this.renderMeetingPreview(m.slidePlan, m);
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
	},
	renderMeetingPreview(plan, meeting) {
		if (!Array.isArray(plan?.slides)) throw new Error('页面计划缺少 slides');
		this.$('meeting-plan').querySelector('.slide-preview-list')?.remove();
		let list = this.el('div', undefined, 'slide-preview-list');
		list.append(this.el('h3', `可视化逐页预览 · ${plan.slides.length} 页`));
		let datasets = new Map((meeting?.datasets || []).map(data => [data.id, data]));
		for (let [index, slide] of plan.slides.entries()) {
			let card = this.el('section', undefined, 'slide-preview');
			let canvas = this.el('div', undefined, 'slide-canvas');
			canvas.append(this.el('h4', slide.title));
			if (slide.kind === 'text') {
				let bullets = this.el('ul');
				for (let point of slide.bullets || []) bullets.append(this.el('li', point));
				canvas.append(bullets);
			}
			else if (slide.kind === 'diagram') {
				let svg = new DOMParser().parseFromString(this.E.selectionDiagramSVG(slide), 'image/svg+xml').documentElement;
				canvas.append(document.importNode(svg, true));
			}
			else if (slide.kind === 'chart') {
				let data = datasets.get(slide.datasetID);
				if (!data) canvas.append(this.el('p', `缺少用户数据集：${slide.datasetID}`, 'warning'));
				else canvas.append(this.renderChartPreview(data, slide.chartType));
			}
			canvas.append(this.el('small', `证据：${(slide.sources || []).join('、') || '无'} · ${index + 1}/${plan.slides.length}`));
			card.append(canvas); list.append(card);
		}
		this.$('meeting-plan').prepend(list);
	},
	renderChartPreview(data, chartType) {
		let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 640 300');
		let values = data.series.flatMap(series => series.values);
		let max = Math.max(...values.map(value => Math.abs(value)), 1);
		let colors = ['#287b89', '#db8753', '#725d9f', '#4d8f62', '#b05454'];
		let width = 500 / Math.max(1, data.labels.length * data.series.length);
		let axis = document.createElementNS(svg.namespaceURI, 'line');
		axis.setAttribute('x1', '65'); axis.setAttribute('x2', '585'); axis.setAttribute('y1', '150'); axis.setAttribute('y2', '150'); axis.setAttribute('stroke', '#9eb0b6'); svg.append(axis);
		for (let [seriesIndex, series] of data.series.entries()) {
			if (chartType === 'line') {
				let line = document.createElementNS(svg.namespaceURI, 'polyline');
				let step = 500 / Math.max(1, data.labels.length - 1);
				line.setAttribute('points', series.values.map((value, index) => `${70 + index * step},${150 - value / max * 90}`).join(' '));
				line.setAttribute('fill', 'none'); line.setAttribute('stroke', colors[seriesIndex % colors.length]); line.setAttribute('stroke-width', '3'); svg.append(line);
			}
			else {
				for (let [valueIndex, value] of series.values.entries()) {
					let rect = document.createElementNS(svg.namespaceURI, 'rect');
					let height = Math.abs(value) / max * 90;
					rect.setAttribute('x', String(70 + (valueIndex * data.series.length + seriesIndex) * width));
					rect.setAttribute('y', String(value >= 0 ? 150 - height : 150)); rect.setAttribute('width', String(Math.max(3, width - 3)));
					rect.setAttribute('height', String(height)); rect.setAttribute('fill', colors[seriesIndex % colors.length]); svg.append(rect);
				}
			}
		}
		for (let [index, label] of data.labels.entries()) {
			let text = document.createElementNS(svg.namespaceURI, 'text');
			let x = chartType === 'line' ? 70 + index * 500 / Math.max(1, data.labels.length - 1)
				: 70 + (index * data.series.length + data.series.length / 2) * width;
			text.setAttribute('x', String(x)); text.setAttribute('y', '258');
			text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '12'); text.textContent = label; svg.append(text);
		}
		let provenance = document.createElementNS(svg.namespaceURI, 'text'); provenance.setAttribute('x', '70'); provenance.setAttribute('y', '286'); provenance.setAttribute('font-size', '10'); provenance.textContent = `数据来源：${data.provenance}`; svg.append(provenance);
		return svg;
	}
});
