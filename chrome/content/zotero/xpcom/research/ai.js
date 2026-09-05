(function (E) {
	E.createAI = function ({ fetch, controller, settings, credential, store, collect }) {
		let running = null;
		return {
			cancel() { running?.abort(); },
			async run({ mode, papers, prompt = '', selection, onStatus = () => {} }) {
				if (running) throw new Error('已有分析进行中，请等待或取消');
				if (!papers.length || papers.length > 12) throw new Error('请选择 1–12 篇文献');
				let config = settings();
				if (!config.endpoint || !config.model) throw new Error('请先在设置中填写模型接口和模型名称');
				let endpoint = E.core.endpoint(config.endpoint);
				let abort = controller();
				running = abort;
				let timer;
				try {
					onStatus('正在提取论文与批注证据…');
					let { sources, warnings } = await collect(papers, selection);
					if (abort.signal.aborted) throw new Error('已取消');
					let memory = papers.map(p => {
						let records = store.get().papers[E.core.paperKey(p)]?.records || [];
						return { title: p.title, previousAnalysis: records.slice(-3).map(r => ({
							question: r.prompt, analysis: E.core.resultMarkdown(r).slice(0, 5000)
						})) };
					});
					let key = await credential(endpoint);
					let headers = { 'Content-Type': 'application/json' };
					if (key) headers.Authorization = `Bearer ${key}`;
					let skill = E.getPaperSkill(mode, config);
					let system = E.paperSystemPrompt(skill, config);
					onStatus(`正在请求 ${config.model}；${sources.length} 个证据片段…`);
					timer = E.setTimeout(() => abort.abort(), 120000);
					let response = await fetch(endpoint + '/chat/completions', {
						method: 'POST', headers, signal: abort.signal, redirect: 'error',
						body: JSON.stringify({ model: config.model, temperature: 0.2, max_tokens: 6000,
							...(new URL(endpoint).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' }, response_format: { type: 'json_object' } } : {}),
							messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({
								task: prompt, template: config.template, selectedText: selection?.text || '', memory,
								sources: sources.map(s => ({ id: s.id, label: s.label, text: s.text })), limitations: warnings
							}) }] })
					});
					if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}；请检查模型、密钥或配额`);
					let payload = await response.json();
					let result = E.core.validateResult(payload.choices?.[0]?.message?.content, sources, mode, true);
					if (abort.signal.aborted) throw new Error('已取消');
					let record = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: new Date().toISOString(),
						mode, prompt, model: config.model, promptPolicy: { skill: skill.id, title: skill.title, version: skill.version, customized: skill.customized, system }, paperKeys: papers.map(E.core.paperKey), result, sources, warnings };
					await store.update(state => {
						for (let paper of papers) {
							let k = E.core.paperKey(paper);
							let entry = state.papers[k] ||= { records: [] };
							entry.records = [...entry.records, record].slice(-30);
						}
					});
					return record;
				}
				catch (error) {
					if (abort.signal.aborted) throw new Error('请求已取消或超过 120 秒；未保存不完整结果');
					throw error;
				}
				finally {
					if (timer) E.clearTimeout(timer);
					running = null;
				}
			}
		};
	};
})(EasySch);
