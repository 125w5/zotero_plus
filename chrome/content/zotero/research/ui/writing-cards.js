/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
	initWritingCards() {
		const view = this.$('view-writing'),
			box = this.el('details', undefined, 'flow-more');
		box.id = 'writing-cards';
		box.open = true;
		box.append(this.el('summary', '模板与内容卡'));
		view.querySelector('.writing-grid').append(box);
		const templates = {
			IMRaD: ['引言', '方法', '结果', '讨论', '结论'],
			文献综述: [
				'研究范围',
				'检索方法',
				'主题分类',
				'方法比较',
				'争议与研究空白',
				'结论',
			],
			系统综述: [
				'研究问题',
				'纳入与排除标准',
				'检索策略',
				'筛选流程',
				'偏倚评估',
				'证据综合',
				'局限',
			],
			方法论文: [
				'问题定义',
				'相关工作',
				'方法总览',
				'关键模块',
				'实验设置',
				'对比与消融',
				'局限',
			],
			实验报告: [
				'实验目的',
				'材料与设备',
				'实验步骤',
				'原始数据',
				'结果分析',
				'误差与局限',
			],
			学位论文章节: ['研究背景', '本章问题', '方法', '实验', '本章小结'],
			开题报告: [
				'研究意义',
				'研究现状',
				'研究问题',
				'技术路线',
				'可行性',
				'进度计划',
			],
			审稿回复: ['审稿意见', '我们的回复', '修改内容', '修改位置'],
		};
		const select = this.el('select');
		select.id = 'writing-template';
		select.setAttribute('aria-label', '内容结构模板');
		for (const name of Object.keys(templates))
			select.append(this.el('option', name));
		box.append(select);
		this.pptButton(
			'预览模板结构',
			() =>
				this.previewWritingInsert(
					templates[select.value]
						.map(
							(h) =>
								'## ' + h + '\n\n[待补充：' + h + '的事实、证据或个人研究内容]',
						)
						.join('\n\n'),
				),
			box,
		);
		const type = this.el('select');
		type.id = 'writing-card-type';
		type.setAttribute('aria-label', '内容卡类型');
		for (const label of [
			'我的理解',
			'我的实验',
			'待验证观点',
			'文献证据',
			'方法',
			'结果',
			'局限',
			'图表说明',
		])
			type.append(this.el('option', label));
		box.append(type);
		const text = this.el('textarea');
		text.id = 'writing-card-body';
		text.rows = 5;
		text.placeholder =
			'填入你的材料。支持文字、Markdown 列表、表格和图片链接；空缺保留待补充，不自动编造。';
		text.setAttribute('aria-label', '内容卡材料');
		box.append(text);
		this.pptButton(
			'预览并插入内容卡',
			() => {
				if (!text.value.trim()) throw Error('请先填入内容卡');
				this.previewWritingInsert('### ' + type.value + '\n\n' + text.value);
			},
			box,
		);
		const more = this.el('details');
		more.append(this.el('summary', '表格、图片与 AI 补充'));
		box.append(more);
		this.pptButton(
			'插入实验数据表',
			() => {
				text.value +=
					'\n\n| 条件 | 结果 | 单位 | 数据来源 |\n| --- | --- | --- | --- |\n| 待填写 | 待填写 | 待填写 | 我的实验 |\n';
			},
			more,
		);
		this.pptButton(
			'从本机加入图片',
			async () => {
				const image = await this.E.importWritingImage();
				if (image) {
					text.value +=
						'\n\n![我的实验图片](<' + image.path.replace(/\\/g, '/') + '>)\n';
					text.dispatchEvent(new Event('input'));
				}
			},
			more,
		);
		this.pptButton(
			'AI 根据当前论文补充建议',
			async () => {
				if (!this.current) throw Error('先选择作为证据的论文');
				if (this.busy) throw Error('已有分析进行中');
				this.busy = true;
				this.$('cancel').hidden = false;
				try {
					const record = await this.E.ai.run({
						mode: 'ask',
						papers: this.papers,
						prompt:
							'请根据原文证据对以下写作材料提出补充建议。区分论文事实与我的内容，缺失实验数据保留待补充，不得填造。输出语言：' +
							this.$('documentLanguage').value +
							'\n材料：' +
							text.value,
						onStatus: (s) => this.status(s),
					});
					this.previewWritingInsert(
						'### AI 补充建议（请核对）\n\n' +
							this.E.core.resultMarkdown(record),
					);
				} finally {
					this.busy = false;
					this.$('cancel').hidden = true;
				}
			},
			more,
		);
		text.oninput = () => {
			clearTimeout(this.cardTimer);
			const key = this.projectKey(),
				body = text.value,
				kind = type.value;
			this.cardTimer = setTimeout(
				() =>
					this.E.store
						.update((s) => {
							s.writingCards ||= {};
							s.writingCards[key] = { body, kind };
						})
						.catch((e) => this.status(e.message, true)),
				300,
			);
		};
	},
	previewWritingInsert(markdown) {
		this.$('writing-insert-preview')?.remove();
		const box = this.el('section', undefined, 'card');
		box.id = 'writing-insert-preview';
		box.append(this.el('h3', '将新增以下内容 · 原正文保留'));
		const rendered = this.el('div', undefined, 'markdown-preview');
		this.renderMarkdown(rendered, markdown);
		box.append(rendered);
		this.pptButton(
			'确认追加到正文',
			async () => {
				const editor = this.$('draft'),
					before = editor.value;
				editor.value = before + '\n\n' + markdown;
				const after = editor.value;
				this.dirty = true;
				await this.saveDraft(false);
				box.replaceChildren(this.el('p', '已追加并保存'));
				this.pptButton(
					'撤销本次追加',
					async () => {
						if (editor.value !== after)
							throw Error('正文已继续修改，请手动撤销以保留新内容');
						editor.value = before;
						this.dirty = true;
						await this.saveDraft(false);
						box.remove();
					},
					box,
				);
			},
			box,
		);
		this.pptButton('取消', () => box.remove(), box);
		this.$('writing-cards').append(box);
	},
});
