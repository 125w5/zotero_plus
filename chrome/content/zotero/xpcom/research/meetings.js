/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	R.meetings = {
		all() { return R.store.get().meetings || {}; },
		async save(data) {
			if (!data.title?.trim() || !data.paperIDs?.length) throw new Error('组会需要名称和文献');
			if (!Number.isFinite(Number(data.minutes)) || data.minutes < 1 || data.minutes > 240) throw new Error('汇报时长应为 1–240 分钟');
			let id = data.id || Zotero.Utilities.randomString(12);
			await R.store.update(state => {
				state.meetings ||= {};
				state.meetings[id] = { turns: [], tasks: [], ...state.meetings[id], ...data, id };
			});
			return id;
		},
		async papers(id) {
			let m = this.all()[id]; if (!m) throw new Error('组会不存在');
			let items = await Zotero.Items.getAsync(m.paperIDs);
			return items.filter(i => i?.isRegularItem()).map(R.library.describe);
		},
		async outline(id, onStatus) {
			let m = this.all()[id];
			let record = await R.ai.run({ mode: 'presentation', papers: await this.papers(id), onStatus,
				prompt: JSON.stringify({ title: m.title, type: m.type, minutes: m.minutes, topic: m.topic, advisor: m.advisor,
					instruction: '制作组会逐页大纲。每页明确核心观点、证据、演讲备注、潜在追问。没有图源时明确标记待补图，不编造图片。' }) });
			await R.store.update(s => { s.meetings[id].outline = record; s.meetings[id].approved = false; delete s.meetings[id].slidePlan; });
			return record;
		},
		async ask(id, answer, onStatus) {
			let m = this.all()[id];
			if (m.turns.length && !answer.trim()) throw new Error('请先回答上一轮问题，或说明不知道及缺少的证据');
			let record = await R.ai.run({ mode: 'ask', papers: await this.papers(id), onStatus,
				prompt: JSON.stringify({ task: '导师追问训练。评估本次回答的准确性、原文依据和回避点；只提出一个有针对性的下一轮问题。首轮根据组会选题提问。区分论文证据和推断，不把历史AI回答当事实。',
					topic: m.topic, advisorFocus: m.advisor, outline: m.outline?.result, history: m.turns.slice(-6).map(t => ({ answer: t.answer, feedback: t.record.result })), answer }) });
			await R.store.update(s => { s.meetings[id].turns.push({ answer, record }); });
			return record;
		},
		async task(id, text) {
			if (!text.trim()) throw new Error('请输入导师问题或会后任务');
			await R.store.update(s => { s.meetings[id].tasks.push({ id: Zotero.Utilities.randomString(12), text, done: false, createdAt: new Date().toISOString() }); });
		}
	};
})(Zotero.Research);
