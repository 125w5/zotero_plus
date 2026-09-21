/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
	initKnowledge() {
		const view = this.$('view-graph');
		view.querySelector('p').textContent =
			'围绕当前论文查看已保存的知识和来源。AI 补充先作为候选，确认后才进入网络。';
		const b = this.pptButton(
			'AI 补全网络',
			() => this.suggestKnowledge(),
			view,
			'primary',
		);
		b.id = 'knowledge-suggest';
		view.insertBefore(b, this.$('graph'));
	},
	async suggestKnowledge() {
		if (!this.current) throw Error('请先选择论文');
		if (this.busy) throw Error('请先等待当前任务完成');
		const paper = this.current;
		this.busy = true;
		this.$('cancel').hidden = false;
		try {
			const record = await this.E.ai.run({
				mode: 'analyze',
				papers: [paper],
				onStatus: (s) => this.status(s),
			});
			const box = this.$('graph-edges');
			box.replaceChildren(this.el('h3', '候选知识 · 核对原文后确认'));
			for (const section of record.result.sections) {
				const evidence = (section.quotes || []).filter((q) =>
					record.sources.some(
						(s) =>
							s.id === q.source_id && s.text.includes(q.text) && q.text.trim(),
					),
				);
				if (!evidence.length) continue;
				const card = this.el('article', undefined, 'card knowledge-candidate');
				card.append(this.el('h4', section.heading), this.el('p', section.body));
				for (const q of evidence) {
					const source = record.sources.find((s) => s.id === q.source_id);
					card.append(this.el('blockquote', q.text));
					this.pptButton(
						'核对原文',
						() => this.E.library.openSource(source),
						card,
					);
				}
				this.pptButton(
					'确认加入网络',
					async () => {
						await this.E.store.update((s) => {
							s.knowledge ||= [];
							if (
								!s.knowledge.some(
									(n) => n.paperID === paper.id && n.text === section.body,
								)
							)
								s.knowledge.push({
									id: this.E.core.task('knowledge').id,
									paperID: paper.id,
									title: section.heading,
									text: section.body,
									type: section.claim_type || 'inference',
									evidence,
									sources: record.sources,
									model: record.model,
									at: record.at,
								});
						});
						card.remove();
						const remaining = [...box.children];
						this.renderGraph();
						if (
							remaining.some((n) => n.classList.contains('knowledge-candidate'))
						)
							box.replaceChildren(...remaining);
					},
					card,
				);
				box.append(card);
			}
			if (!box.querySelector('article'))
				box.append(
					this.el(
						'p',
						'没有找到能逐字匹配的证据，暂不创建 AI 关系。可先补充 PDF 全文或批注。',
						'warning',
					),
				);
		} finally {
			this.busy = false;
			this.$('cancel').hidden = true;
		}
	},
	renderGraph() {
		const target = this.$('graph'),
			detail = this.$('graph-edges');
		target.replaceChildren();
		detail.replaceChildren();
		if (!this.current) {
			target.append(this.el('p', '先选择论文，再逐步扩展知识网络。', 'empty'));
			return;
		}
		const paper = this.current,
			nodes = (this.E.store.get().knowledge || []).filter(
				(n) => n.paperID === paper.id,
			),
			root = this.el('h3', paper.title);
		target.append(root);
		const grid = this.el('div', undefined, 'knowledge-grid');
		target.append(grid);
		if (nodes.length) {
			const make = (tag, attrs, text) => {
				const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
				for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
				if (text) n.textContent = text;
				return n;
			};
			const height = Math.max(220, nodes.length * 70),
				svg = make('svg', {
					viewBox: `0 0 800 ${height}`,
					role: 'img',
					'aria-label': '当前论文与已确认知识的来源网络',
				});
			svg.append(
				make('rect', {
					x: 10,
					y: height / 2 - 25,
					width: 200,
					height: 50,
					rx: 8,
					fill: 'var(--line)',
				}),
				make(
					'text',
					{ x: 20, y: height / 2 + 5, fill: 'currentColor' },
					'当前论文 · 来源',
				),
			);
			nodes.forEach((n, i) => {
				const y = i * 70 + 30;
				svg.append(
					make('path', {
						d: `M 210 ${height / 2} L 300 ${height / 2} L 300 ${y} L 370 ${y}`,
						fill: 'none',
						stroke: 'var(--muted)',
					}),
					make('rect', {
						x: 370,
						y: y - 22,
						width: 400,
						height: 44,
						rx: 6,
						fill: 'var(--line)',
					}),
					make(
						'text',
						{ x: 385, y: y + 5, fill: 'currentColor' },
						n.title.slice(0, 30),
					),
				);
			});
			target.insertBefore(svg, grid);
		}
		for (const node of nodes) {
			const card = this.el('article', undefined, 'card');
			card.append(
				this.el('small', '论文 → 经用户确认的 AI 归纳'),
				this.el('h4', node.title),
				this.el('p', node.text),
			);
			const sources = this.el('details');
			sources.append(this.el('summary', '查看关系证据'));
			for (const q of node.evidence) {
				sources.append(this.el('blockquote', q.text));
				const source = node.sources.find((s) => s.id === q.source_id);
				this.pptButton(
					'回到来源',
					() => this.E.library.openSource(source),
					sources,
				);
			}
			this.pptButton(
				'移除此关系',
				async () => {
					await this.E.store.update(
						(s) => (s.knowledge = s.knowledge.filter((n) => n.id !== node.id)),
					);
					this.renderGraph();
				},
				sources,
			);
			card.append(sources);
			grid.append(card);
		}
		const refs =
			this.E.store.get().discovery?.[paper.doi?.toLowerCase() + ':references'];
		if (refs?.records.length) {
			const list = this.el('details');
			list.append(
				this.el('summary', `引用 ${refs.records.length} 篇论文 · Crossref`),
			);
			for (const ref of refs.records) {
				const p = this.el('p', ref.title);
				list.append(p);
			}
			target.append(list);
		}
		if (!nodes.length)
			grid.append(
				this.el(
					'p',
					'还没有确认的知识节点。点击“AI 补全网络”，核对证据后保存；这里不会把标签相似误当作论文结论。',
					'empty',
				),
			);
	},
});
