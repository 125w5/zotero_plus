(function (E) {
	const Policy=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-ai-policy.mjs');
	const STOPPED = '已停止本次分析；未保存不完整结果，可重新运行';
	const TIMED_OUT = '模型 120 秒内未完成回答；未保存不完整结果，请缩小问题或选段后重试';
	E.createAI = function ({ fetch, controller, settings, credential, store, collect }) {
		// Each run owns its controller. A page stops its own job through the
		// signal it passes, so no control can stop a job another page started.
		let jobs = new Set();
		let peek = (...path) => (store.peek ? store.peek(...path) : store.get(...path));
		return {
			// Kept for older callers. Stopping every job here would also end the jobs
			// other pages own (DOCX, reader), so it stops nothing.
			cancel() {},
			cancelAll() {
				for (let job of jobs) job.abort();
			},
			async run({ mode, papers, prompt = '', selection, memoryContext = [], sourceContext = [], evidenceByID = true, signal, onStatus = () => {} }) {
				Policy.assertAIAction(['write','continue','coauthor','rewrite','propose'].includes(mode)?mode:'research_discuss');
				Policy.assertResearchPrompt(prompt);
				if (!papers.length || papers.length > 12) throw new Error('请选择 1–12 篇文献');
				let config = settings();
				const skill = E.assertPaperInstructions(E.getPaperSkill(mode, config), config);
				if (!config.endpoint || !config.model) throw new Error('请先在设置中填写模型接口和模型名称');
				if (signal?.aborted) throw new Error(STOPPED);
				let endpoint = E.core.endpoint(config.endpoint);
				let abort = controller(), stop = () => abort.abort(), timer, timedOut = false;
				jobs.add(abort);
				try {
					signal?.addEventListener('abort', stop, { once: true });
					if (E.resolveModel) config = await E.resolveModel(config, { signal: abort.signal });
					onStatus('正在提取论文与批注证据…');
					let { sources, warnings } = await collect(papers, selection);
					sources=[...sources,...sourceContext].filter((s,i,a)=>a.findIndex(x=>x.id===s.id)===i);
					if (abort.signal.aborted) throw new Error('已取消');
					let memory = selection?.text ? [] : papers.map(p => {
						let records = peek('papers', E.core.paperKey(p), 'records') || [];
						return { title: p.title, previousAnalysis: records.slice(-3).map(r => ({
							question: r.prompt, analysis: E.core.resultMarkdown(r).slice(0, 5000)
						})) };
					});
					memory.push(...memoryContext);
					let key = await credential(endpoint);
					let headers = { 'Content-Type': 'application/json' };
					if (key) headers.Authorization = `Bearer ${key}`;
					let system = E.paperSystemPrompt(skill, config);
					if(mode==='ask')system+='\n本次为简洁学术问答：用户当前问题优先于个人全文分析模板。先直接回答，通常 150–300 个中文字，最多三个小节；不要补充问题未要求的全文综述。保留关键条件与证据；术语准确，表达易懂。后续疑问仅放 questions。用户明确要求长篇时才展开。';
                    const binder=evidenceByID?ChromeUtils.importESModule('chrome://zotero/content/research/shared/academic-evidence.mjs'):null;
                    const quoteExcerpts=binder?.academicExcerpts(sources);
                    if(binder)system+='\n本次证据输出格式覆盖上面的 quotes 规则：每个 sections 对象包含 heading、body、claim_type、quoteIDs。quoteIDs 只从 quoteExcerpts 的 id 选择（如 Q1）；不用抄写引文，不输出 quotes 或 sources，软件会自动绑定原文。没有直接依据的推断 quoteIDs 可为空，claim_type 使用 inference 或 insufficient_evidence。保留 questions 和 keywords。';
					onStatus(E.aiProgress?.(config.model, '正在阅读证据') || `正在阅读证据 · ${config.model}`);
					timer = E.setTimeout(() => {
						timedOut = true;
						abort.abort();
					}, 120000);
                    const userInput={task:prompt,template:config.template,selectedText:selection?.text||'',memory,
                        sources:sources.map(s=>({id:s.id,label:s.label,...(!binder?{text:s.text}:{})})),...(binder?{quoteExcerpts}:{}),limitations:warnings};
                    let result, repair;
                    const chat=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-completion.mjs');
                    for(let attempt=0;attempt<2;attempt++) {
                        const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify({...userInput,...(repair?{formatCorrection:repair}: {})})}];
                        const stream=chat.chatRequiresStreaming(endpoint);
                        const response=await fetch(endpoint+'/chat/completions',{method:'POST',headers,signal:abort.signal,redirect:'error',
                            body:JSON.stringify({model:config.model,...(Policy.completionParameters?Policy.completionParameters({...config,endpoint},6000,{temperature:.2}):{temperature:.2,max_tokens:6000}),...(stream?{stream:true}:{}),
                                ...(new URL(endpoint).hostname==='api.deepseek.com'?{thinking:{type:'disabled'},response_format:{type:'json_object'}}:{}),messages})});
                        if(!response.ok)throw Error(`模型接口返回 HTTP ${response.status}；请检查模型、密钥或配额`);
                        const completion=await chat.readChatCompletion(response,{stream});
                        if(completion.finishReason==='length')throw Error('回答超过输出上限；请缩小问题范围，未保存不完整结果');
                        try {
                            let raw=completion.text;
                            if(binder)raw=binder.bindAcademicQuotes(raw,quoteExcerpts);
                            result=E.core.validateResult(raw,sources,mode,true);break;
                        } catch(error) {
                            if(attempt)throw error;
                            repair=error.message+'。仅修复格式与证据编号。sections 含 heading、body、claim_type、quoteIDs；事实必须选择真实 Q 编号，未知内容标 insufficient_evidence，禁止编造引文。';
                            onStatus(E.aiProgress?.(config.model,'正在核对回答格式与来源')||'正在核对回答格式与来源…');
                        }
                    }
					if (abort.signal.aborted) throw new Error('已取消');
					let record = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: new Date().toISOString(),
						mode, prompt, model: config.model, promptPolicy: { skill: skill.id, title: skill.title, version: skill.version, customized: skill.customized, system }, paperKeys: papers.map(E.core.paperKey), result, sources, warnings };
					await store.update(state => {
						for (let paper of papers) {
							let k = E.core.paperKey(paper);
							let entry = state.papers[k] ||= { records: [] };
							entry.records.push(record);
						}
					});
					return record;
				}
				catch (error) {
					if (abort.signal.aborted) throw new Error(timedOut ? TIMED_OUT : STOPPED);
					throw error;
				}
				finally {
					if (timer) E.clearTimeout(timer);
					jobs.delete(abort);
					signal?.removeEventListener('abort', stop);
				}
			}
		};
	};
})(EasySch);
