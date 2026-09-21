/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
	meetingID: null,
	initMeetings() {
		let taskBox = this.el('aside'); taskBox.id='meeting-task-feedback'; taskBox.hidden=true; taskBox.style.cssText='position:fixed;right:18px;bottom:18px;max-width:360px;padding:14px;background:var(--bg,#fff);color:var(--text,#17364a);border:1px solid #718b95;border-radius:8px;z-index:1000';
		let taskText=this.el('p','正在整理素材与页面…'),cancelTask=this.el('button','取消当前任务'),retryTask=this.el('button','重新执行');
		taskBox.append(taskText,cancelTask,retryTask); document.body.append(taskBox);
		let hideTask=this.el('button','收起提示');hideTask.onclick=()=>taskBox.hidden=true;taskBox.append(hideTask);
		cancelTask.onclick=()=>{this.meetingAbort?.abort();this.E.ai.cancel();taskText.textContent='正在取消；原图与已保存的页面不会被覆盖';};
		retryTask.onclick=()=>this.lastMeetingAction&&this.runMeeting(this.lastMeetingAction).catch(e=>this.status(e.message,true));
		this.meetingTaskUI={taskBox,taskText,cancelTask,retryTask};
		let nav = this.el('button', '组会与导师模式'); nav.dataset.tab = 'meetings';
		nav.addEventListener('click', () => this.show('meetings'));
		document.querySelector('nav').append(nav);

		this.refreshMeetingList();
		let chartChoice = this.el('select'); chartChoice.id = 'meeting-chart-type'; chartChoice.setAttribute('aria-label','根据数据含义选择图形');
		for (let [value,label] of [['scatter','两变量关系：散点图'],['heatmap','多参数矩阵：热力图'],['line','时间变化：折线图'],['bar','类别比较：柱状图']]) { let option = this.el('option',label); option.value=value; chartChoice.append(option); }
		this.$('meeting-data').after(chartChoice);
		let chartButton = this.el('button','用已导入数据添加图表页'); chartChoice.after(chartButton);
		chartButton.addEventListener('click', () => this.runMeeting(async () => {
			let id=this.requireMeeting(),m=this.E.meetings.all()[id],data=m.datasets?.[0];
			if (!data || !m.outline) throw new Error('请先导入真实数据并准备组会大纲或原图页');
			await this.E.store.update(s=>{let plan=s.meetings[id].slidePlan ||= {version:1,title:m.title,slides:[]}; plan.slides.push({kind:'chart',title:data.id,chartType:chartChoice.value,datasetID:data.id,sources:[],notes:data.provenance});});
			return '已添加用户数据页；请核对单位、样本量及数据来源';
		}).catch(e=>this.status(e.message,true)));
		let assetButton = this.el('button', '选择论文原图生成讲解页'); assetButton.id = 'meeting-paper-assets';
		this.$('meeting-layout').before(assetButton);
		assetButton.addEventListener('click', () => this.runMeeting(async () => {
			let assets = this.E.assets.tray();
			if (!assets.length) throw new Error('请在 PDF 顶部“论文图表”中核对并选择原图');
			if (!this.meetingID) this.meetingID = await this.E.meetings.save({ title: '论文原图组会', minutes: 15, paperIDs: [...new Set(assets.map(a => a.paperItemID))] });
			let plan = this.E.assets.makePlan(assets), sources = this.E.assets.evidence(assets);
			await this.E.store.update(s => { let m = s.meetings[this.meetingID]; m.assets = assets; m.slidePlan = plan;
				m.outline = { sources, result: { sections: assets.map(a => ({ heading: a.label, body: a.caption || '待补充原文说明', sources: ['A-' + a.id], quotes: [], claim_type: 'author_claim' })) } }; });
			this.refreshMeetingList(); return `已采用 ${assets.length} 个论文原图素材；请核对每页用途与讲述重点`;
		}).catch(e => this.status(e.message, true)));
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
			let file = await this.E.pick(window, '选择用户数据 CSV / XLSX / JSON', 'file');
			if (!file) return;
			let data = await this.E.readChartData(file);
			await this.E.store.update(s => { s.meetings[id].datasets = data; delete s.meetings[id].slidePlan; });
			this.loadMeeting();
			this.status('已导入数据；重新规划页面后可生成数据图');
		});
		this.bind('meeting-export', () => this.runMeeting(async signal => {
			let m = this.E.meetings.all()[this.requireMeeting()];
			if (!m.outline || !this.$('meeting-approved').checked) throw new Error('先生成并核对大纲和引用来源');
			let folder = await this.E.pick(window, '选择 PPTX 导出目录', 'folder');
			if (!folder) return;
			let edited = this.$('meeting-slide-plan').value.trim();
			let plan = edited ? JSON.parse(edited) : null;
			let output = await this.E.runArtifactEngine({ operation: 'export', directory: folder, title: m.title, record: m.outline, plan, datasets: m.datasets || [], assets: m.assets || [] }, text => {this.status(text);this.meetingTaskUI.taskText.textContent=text;}, signal);
			await this.E.store.update(s => { s.meetings[m.id].lastArtifact = output; if (plan) s.meetings[m.id].slidePlan = plan; });
			await this.E.reveal(output.path);
			return 'PPTX 与图形已导出；请逐页核对排版和证据。';
		}));
		this.bind('meeting-preview', () => {
			let plan = JSON.parse(this.$('meeting-slide-plan').value);
			this.renderMeetingPreview(plan, this.E.meetings.all()[this.requireMeeting()]);
			this.status('已按当前 JSON 刷新预览；导出前仍需勾选人工核对');
		});
		this.bind('meeting-render', () => this.runMeeting(async signal => {
			let m = this.E.meetings.all()[this.requireMeeting()];
			if (!m.outline) throw new Error('请先生成大纲');
			let text = this.$('meeting-slide-plan').value.trim(), plan = text ? JSON.parse(text) : null;
			let output = await this.E.previewPresentation({ title: m.title, record: m.outline, plan, datasets: m.datasets || [], assets: m.assets || [] }, text => {this.status(text);this.meetingTaskUI.taskText.textContent=text;}, signal);
			await this.E.store.update(s => { s.meetings[m.id].lastArtifact = output; });
			return output.previews ? '实际 PPTX 已逐页渲染，请核对图片和检查报告' : 'PPTX 已生成，但渲染未完成：' + (output.warnings || []).join('；');
		}));
		this.bind('meeting-add-task', async () => { await this.E.meetings.task(this.requireMeeting(), this.$('meeting-task').value); this.$('meeting-task').value = ''; this.loadMeeting(); });
	},
	requireMeeting() { if (!this.meetingID) throw new Error('请先保存或选择组会'); return this.meetingID; },
	async runMeeting(action) {
		if (this.busy) throw new Error('请等待当前分析完成');
		this.busy = true;
		this.meetingAbort=new AbortController(); this.lastMeetingAction=action;
		let ui=this.meetingTaskUI; ui.taskBox.hidden=false; ui.retryTask.hidden=true;ui.cancelTask.hidden=false; ui.taskText.textContent='正在整理素材与页面…';
		try { let message = await action(this.meetingAbort.signal); if(this.meetingAbort.signal.aborted) throw new Error('已取消'); this.loadMeeting(); this.status(message || '已保存，请核对原文'); ui.taskText.textContent=message||'结果已保存，可在当前页面核对'; }
		catch(e) {ui.taskText.textContent=this.meetingAbort.signal.aborted?'已取消，已保存的素材保留':'未完成：'+e.message;ui.retryTask.hidden=false;throw e;}
		finally { this.busy = false; this.meetingAbort=null;ui.cancelTask.hidden=true; }
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
		if (m?.lastArtifact) this.renderActualPreview(m.lastArtifact).catch(error => this.status(error.message, true));
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
		list.append(this.el('h3', `页面草稿 · ${plan.slides.length} 页（非导出文件渲染）`));
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
			else if (slide.kind === 'asset') {
				this.renderAssetControls(card,slide,plan,meeting,index);
				let asset = meeting.assets?.find(a => a.id === slide.assetIDs[0]);
				if (asset) { let img = this.el('img'); img.alt = asset.label; img.style.cssText = 'max-width:75%;height:60%;object-fit:contain'; this.E.previewImage(asset.thumbnail).then(src => img.src = src); canvas.append(img); }
				canvas.append(this.el('p', slide.assetReason));
				let details = this.el('details'); details.append(this.el('summary', '为何采用此素材与布局'));
				details.append(this.el('p', `${slide.slidePurpose}；${slide.speakerFocus}；布局：${slide.layoutType}`)); card.append(details);
			}
			else if (slide.kind === 'table') {
				let table = this.el('table');
				for (let cells of slide.rows || []) { let row = this.el('tr'); for (let cell of cells) row.append(this.el('td', cell)); table.append(row); }
				canvas.append(table);
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
	async renderActualPreview(artifact) {
		let list = this.el('section', undefined, 'actual-slide-previews');
		list.append(this.el('h3', artifact.previews?.length ? '实际 PPTX 渲染' : 'PPTX 渲染未完成'));
		if (!artifact.previews?.length) list.append(this.el('p', (artifact.warnings || []).join('；')));
		this.$('meeting-plan').prepend(list);
		for (let [index, path] of (artifact.previews || []).entries()) {
			let img = this.el('img'); img.alt = `实际幻灯片 ${index + 1}`;
			img.style.cssText = 'width:100%;aspect-ratio:16/9;object-fit:contain;background:white';
			img.src = await this.E.previewImage(path); list.append(img);
			let warnings = artifact.renderReport?.pages[index]?.warnings || [];
			list.append(this.el('p', `第 ${index + 1} 页：${warnings.join('；') || '机械检查未发现异常，仍需人工核对'}`));
		}
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
