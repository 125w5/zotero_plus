/* SPDX-License-Identifier: AGPL-3.0-or-later */
import { assemblyTaskContext, assemblyBlockText } from '../manuscript/assembly-task-context.mjs';
export {assemblyTaskContext};
export const WORKBENCH_MODES = [
	{ id: 'auto', label: '自动', hint: '根据问题选择阅读、检索或整理' },
	{ id: 'search', label: '查找文献', hint: '查找公开文献，先看题录和摘要' },
	{ id: 'evaluate', label: '评估方案', hint: '比较接近工作，核对实验可行性' },
	{ id: 'organize', label: '整理素材', hint: '按研究主题整理已有素材' },
	{ id: 'layout', label: '梳理顺序', hint: '整理素材的论证顺序，不生成论文正文' },
];

// Migrate the old single conversation without changing its messages, source
// anchors or user draft. Sessions reference the same Zotero library and assets.
export function workbenchSessions(value = {}, now = Date.now()) {
	const source = value && typeof value === 'object' ? value : {};
	let sessions = Array.isArray(source.sessions) ? source.sessions.filter(session => session && typeof session.id === 'string') : [];
	// Preserve real legacy transcripts and unsent text without manufacturing a
	// saved conversation merely because an empty input surface was opened.
	if (!sessions.length && (source.messages?.length || source.draft)) sessions = [{ id: 'conversation-' + now, title: '研究对话', messages: Array.isArray(source.messages) ? source.messages : [], mode: source.mode || 'auto', projectID: source.projectID || '', selectedID: source.selectedID || '', draft: source.draft || '', createdAt: new Date(now).toISOString() }];
	const activeSessionID = sessions.some(session => session.id === source.activeSessionID) ? source.activeSessionID : sessions[0]?.id || '';
	return { version: 2, activeSessionID, sessions, home: source.home || {}, scopeSessions: source.scopeSessions || {} };
}

export function isAcademicWorkbenchSource(row) {
	const title = String(row?.title || '').normalize('NFKC').trim();
	if (!title || /简历|求职|身份证|户口|发票|收据|(?:^|\s)(?:curriculum vitae|résumé|resume)(?:\s|$)/iu.test(title)) return false;
	return !['bill', 'personalDocument', 'resume', 'receipt'].includes(row?.documentType);
}

export function workbenchSourceIdentity(row) {
	if (row?.stableID) return row.stableID;
	if (row?.kind === 'paper' || typeof row?.id === 'number' && !row?.source) return 'paper:' + row.id;
	return 'web:' + (row?.doi || row?.id || row?.url || '');
}

// Retrieve a small amount of relevant older discussion alongside recent turns.
// Saved history remains complete; this is a bounded model context, not a summary
// that silently rewrites prior evidence or confirmed statements.
export function researchConversationContext(messages,prompt,{recent=12,older=6,characterBudget=36000}={}) {
	const rows=(Array.isArray(messages)?messages:[]).filter(row=>['user','assistant'].includes(row.role)&&typeof row.text==='string'&&row.text.trim());
	if(rows.at(-1)?.role==='user'&&rows.at(-1).text.trim()===String(prompt).trim())rows.pop();
	const normalize=text=>String(text||'').normalize('NFKC').toLowerCase(),query=normalize(prompt),terms=new Set(query.match(/[a-z][a-z0-9_-]{1,}|[\u3400-\u9fff]{2}/gu)||[]);
	for(const run of query.match(/[\u3400-\u9fff]{2,}/gu)||[])for(let index=0;index<run.length-1;index++)terms.add(run.slice(index,index+2));
	const boundary=Math.max(0,rows.length-recent),ranked=rows.slice(0,boundary).map((row,index)=>{const text=normalize(row.text);return {index,score:[...terms].reduce((score,term)=>score+(text.includes(term)?term.length:0),0)};}).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||b.index-a.index),selected=new Set();
	for(const hit of ranked){if(selected.size>=older)break;selected.add(hit.index);const partner=rows[hit.index].role==='user'?hit.index+1:hit.index-1;if(partner>=0&&partner<boundary&&selected.size<older)selected.add(partner);}
	const candidates=[...selected].sort((a,b)=>a-b).map(index=>rows[index]).concat(rows.slice(boundary)),kept=[],turns=[];let characters=0;
	for(const row of candidates){if(row.role==='assistant'&&turns.at(-1)?.[0].role==='user')turns.at(-1).push(row);else turns.push([row]);}
	for(let index=turns.length-1;index>=0;index--){const turn=turns[index],size=turn.reduce((sum,row)=>sum+Math.min(row.text.length,8000),0);if(characters+size>characterBudget)continue;kept.unshift(...turn);characters+=size;}
	// A source explanation without its question is ambiguous. Keep whole turns
	// within the budget; saved conversations themselves are never shortened.
	while(kept[0]?.role==='assistant'&&kept.length>1)kept.shift();return kept;
}

// Keep actual user choices separately from the bounded transcript. These are
// application data, not generated summaries or higher-priority instructions.
// Preserve complete choices and real source IDs; omit oversized records rather
// than silently rewriting a user's answer or including hidden reasoning.
export function researchDecisionContext(history, sourceRows, {limit=10,budget=6000}={}) {
	const sources=!Array.isArray(sourceRows)&&typeof sourceRows?.values==='function'?[...sourceRows.values()]:sourceRows||[];
	const known=new Set(sources.filter(row=>isAcademicWorkbenchSource({...row,title:row?.title||row?.label})).map(row=>row.stableID));
	const records=(Array.isArray(history)?history:[]).filter(row=>row?.role==='assistant').flatMap(row=>Array.isArray(row.researchDecisions)?row.researchDecisions:[]),kept=[],seen=new Set();
	for(let index=records.length-1;index>=0&&kept.length<limit;index--){
		const row=records[index];if(!row||row.action||typeof row.question!=='string'||!row.question.trim()||row.question.length>600||typeof row.answer!=='string'||!row.answer.trim()||row.answer.length>4000)continue;
		if(!Array.isArray(row.options)||row.options.length<2||row.options.length>4||row.options.some(option=>typeof option!=='string'||!option.trim()||option.length>160)||new Set(row.options.map(option=>option.trim())).size!==row.options.length)continue;
		if(!Array.isArray(row.sourceIDs)||row.sourceIDs.length>8||row.sourceIDs.some(id=>typeof id!=='string'||!known.has(id)))continue;
		const value={question:row.question,answer:row.answer,options:[...row.options],sourceIDs:[...new Set(row.sourceIDs)]},key=JSON.stringify(value);if(seen.has(key))continue;
		if(JSON.stringify([value,...kept]).length>budget)continue;seen.add(key);kept.unshift(value);
	}
	return kept;
}

export function resolveWorkbenchMode(mode, prompt) {
	if (requestsAssemblyPage(prompt)) return requestsPageMaterials(prompt)?'page_place':'page';
	if (requestsMaterialPlacement(prompt)) return 'place';
	if (requestsAssemblyCheck(prompt)) return 'check';
	if (WORKBENCH_MODES.some(item => item.id === mode) && mode !== 'auto') return mode;
	const text = String(prompt || '').normalize('NFKC');
	// Topic words alone do not request a new project experiment plan. In
	// particular, ordinary source explanations must work without a project.
	const explanation = /(解释|解读|翻译|概括|说明|是什么|什么是|如何理解|为什么|区别|原理|概念)/u.test(text);
	const planRequest = /(?:^|[，,；;。])\s*(?:请|帮我|为我|然后|并|再)?\s*(?:评估|制定|设计|规划|改进|优化|修改|完善|给出|提供).{0,24}(?:实验|方案|假设|预处理|鲁棒性|消融)|分析.{0,12}可行性|可行性分析/u.test(text);
	if (/(整理|调整|梳理|优化|重排).{0,16}(布局|排布|排序|逻辑顺序|论证顺序)/u.test(text)) return 'layout';
	if (/(设计|规划|梳理|安排).{0,20}(写作流程|论文装配流程|我要写的流程|论证流程|论文结构)/u.test(text)) return 'layout';
	if (/(整理|归组|分类|合并).{0,12}(素材|主题|标签)|(素材|主题|标签).{0,12}(整理|归组|分类)/u.test(text)) return 'organize';
	const materialRequest = /(推荐|查找|检索|搜索|寻找|找|筛选|挑选|选出).{0,24}(已有|可用|可以使用|适合|相关)?[^。；;\n]{0,12}素材|素材.{0,16}(推荐|查找|检索|搜索|筛选|挑选)/u.test(text);
	if (materialRequest && (!explanation || /请|帮我|为我|我想|我要/u.test(text))
		&& !/(不要|不用|无需|不需要|别).{0,8}(推荐|查找|检索|搜索|寻找|找|筛选|挑选|选出)/u.test(text)) return 'materials';
	if (/(查找|检索|搜索|寻找|补充|搜集).{0,18}(论文|文献|资料)|有没有.{0,12}(论文|文献)/u.test(text)
		|| /推荐.{0,18}(论文|文献)/u.test(text) && (!explanation || /请|帮我|为我|我想|我要/u.test(text))) return 'search';
	if (explanation && !planRequest) return 'discuss';
	if (/(布局|排布|排序|逻辑顺序|论证顺序)/u.test(text)) return 'layout';
	if (planRequest || /(评估|可行性|最小验证|实验方案)/u.test(text)) return 'evaluate';
	return 'discuss';
}

export function requestsAssemblyPage(prompt){
	const text=String(prompt||'').normalize('NFKC');
	if(/(?:不要|不用|无需|别|不允许).{0,12}(?:新增|新建|添加|插入|增加|创建).{0,8}页/u.test(text)||/\b(?:do not|don't|never)\b.{0,25}\b(?:insert|add|create)\b.{0,15}\bpage\b/iu.test(text))return false;
	if(/(?:如何|怎么|步骤|为什么).{0,12}(?:新增|新建|添加|插入|增加|创建).{0,8}页/u.test(text)&&!/(?:请|帮我|为我|现在|直接).{0,24}(?:新增|新建|添加|插入|增加|创建)/u.test(text))return false;
	return /(?:新增|新建|添加|插入|增加|创建).{0,8}(?:一|1|个|张|空白|新)*页/u.test(text)||/\b(?:insert|add|create)\b.{0,15}\b(?:blank |new )?page\b/iu.test(text);
}
export function requestsPageMaterials(prompt){const text=String(prompt||'').normalize('NFKC');return /(?:放|填|添加|插入|加入).{0,20}(?:素材|证据|原文|引用|你说的内容|上述内容)/u.test(text)&&!/(?:不要|不用|别).{0,8}(?:放|填|添加|插入|加入).{0,20}(?:素材|证据|原文|引用|内容)/u.test(text);}

export function requestsMaterialPlacement(prompt) {
	const text = String(prompt || '').normalize('NFKC');
	const action = '(?:导入|插入|放进|放入|加入|放到|添加到|拖进|拖入)';
	if (new RegExp('(?:不要|不用|无需|不需要|别|不允许).{0,10}' + action, 'u').test(text)) return false;
	if (/\b(?:do not|don't|never)\b.{0,30}\b(?:insert|add|attach|import)\b/i.test(text)) return false;
	if (/(?:如何|怎么|步骤|为什么).{0,12}(?:导入|插入|放进|放入|加入)/u.test(text)
		&& !/(?:请|帮我|为我|我确认|现在|直接|立即).{0,24}(?:导入|插入|放进|放入|加入)/u.test(text)) return false;
	if (/\b(?:how to|how do I|explain how)\b.{0,30}\b(?:insert|add|attach|import)\b/i.test(text)) return false;
	return new RegExp('素材[^。；;\\n]{0,40}' + action + '[^。；;\\n]{0,20}(?:装配|论文|章节|模块|段落|项目|这里|进去)|'
		+ action + '[^。；;\\n]{0,20}素材[^。；;\\n]{0,20}(?:装配|论文|章节|模块|段落|项目)|'
		+ '(?:把|将)[^。；;\\n]{0,18}素材[^。；;\\n]{0,12}' + action + '(?:这里|进去)', 'u').test(text)
		|| /\b(?:insert|add|attach|import)\b.{0,35}\b(?:existing )?materials?\b.{0,30}\b(?:assembly|project|manuscript|section|block)\b/i.test(text);
}

export function requestsAssemblyCheck(prompt) {
	const text = String(prompt || '').normalize('NFKC');
	if (/(?:不要|不用|别|无需).{0,12}(?:核验|核对|检查|校验|核证据)/u.test(text)) return false;
	return /(?:核验|核对|检查|校验).{0,20}(?:当前项目|装配|素材来源|素材证据|证据缺口|证据链|论文结构)|(?:装配|当前项目).{0,20}(?:核验|检查|核证据)|核证据/u.test(text);
}

export function boundAssemblyContext(value, project, availableMaterials = []) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value.projectID !== project?.id) throw Error('装配讨论与当前项目不一致，请重新选择项目');
	if (!['direction','structure','materials','block'].includes(value.stage)) throw Error('装配讨论阶段无效，请重新打开当前模块');
	const section = project.sections?.find(row => row.id === value.sectionID), block = value.blockID ? project.blocks?.find(row => row.id === value.blockID) : null;
	if (value.sectionID && !section || value.blockID && (!block || block.sectionID !== value.sectionID)) throw Error('当前装配模块已经变化，请重新选择');
	if (value.blockID && project.ui?.blockID && value.blockID !== project.ui.blockID) throw Error('当前装配模块已经变化，请重新选择');
	const ids = [...new Set((block?.materials || []).map(row => row.id))], supplied = value.materialIDs;
	if (!Array.isArray(supplied) || supplied.length !== ids.length || new Set(supplied).size !== supplied.length || supplied.some(id => typeof id !== 'string' || !ids.includes(id))) throw Error('装配讨论素材与当前模块不一致，请重新选择');
	if (ids.some(id => !availableMaterials.some(row => row.id === id))) throw Error('当前模块的部分素材已经不存在，请重新读取');
	const raw = assemblyBlockText(block), actual = assemblyTaskContext(project);
	const normalize = text => String(text || '').replace(/\s+/gu,' ').trim();
	if (normalize(value.userText) !== normalize(raw.slice(0,8000))) throw Error('当前人工内容已经变化，请重新发起讨论');
	if (value.stage !== actual.stage || value.sectionID !== actual.sectionID || value.blockID !== actual.blockID) throw Error('当前装配讨论阶段已经变化，请重新发起讨论');
	return {projectID: project.id, title: project.title, stage: value.stage, sectionID: section?.id || '', sectionTitle: section?.title || '',
		blockID: block?.id || '', blockType: block?.type || '', userText: raw.slice(0,8000), materialIDs: ids, currentTask: String(value.currentTask || '').replace(/\s+/gu,' ').trim().slice(0,50),...(actual.writingResult?{writingResult:actual.writingResult}:{})};
}

// Canonicalize only aliases of sources the application actually read. Ambiguous
// paper-local IDs and unknown citations cannot silently acquire a source.
export function bindWorkbenchCitations(text, sourceRows) {
	const sources = !Array.isArray(sourceRows) && typeof sourceRows?.values === 'function' ? [...sourceRows.values()] : sourceRows || [], aliases = new Map(), canonical = new Set(), paperReferences = new Set();
	const referenceNumbers = value => {
		if (!/^\s*\d+(?:\s*(?:[,，;；]|[-–—])\s*\d+)*\s*$/u.test(value)) return [];
		return value.split(/[,，;；]/u).flatMap(part => {const range=part.trim().split(/[-–—]/u).map(Number);return range.length===1?[String(range[0])]:range[1]>=range[0]&&range[1]-range[0]<=100?Array.from({length:range[1]-range[0]+1},(_,index)=>String(range[0]+index)):[];});
	};
	for (const row of sources) {
		const stable = row.stableID; if (!stable) continue; canonical.add(stable);
		// Paper-local reference numbers are words in the source, not application
		// source IDs. Keep only numbers actually present in a read original.
		for (const original of [row.sourceText,row.text,row.quote,row.anchor?.sourceText,...(row.anchors||[]).map(anchor=>anchor?.sourceText)]) {
			for (const match of String(original||'').matchAll(/\[([^\]\n]+)\]/gu)) for (const number of referenceNumbers(match[1])) paperReferences.add(number);
		}
		for (const alias of [stable,row.id,row.materialID,row.sourceRecordID].filter(value => typeof value === 'string' || typeof value === 'number').map(String)) {
			const previous = aliases.get(alias); aliases.set(alias, previous && previous !== stable ? null : previous === null ? null : stable);
		}
	}
	const resolve = id => canonical.has(id) ? id : aliases.get(id);
	return String(text || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\])*?(?<!\\)\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|`[^`\n]+`|\[([^\]\n]+)\]/gu, (full, id) => {
		if (id === undefined) return full;
		const numbers=referenceNumbers(id);if(numbers.length&&numbers.every(number=>paperReferences.has(number)))return full;
		const exact = resolve(id); if (exact) return '[' + exact + ']';
		const parts = id.split(/[,，;；]\s*/u); if (parts.length > 1 && parts.every(part => resolve(part))) return parts.map(part => '[' + resolve(part) + ']').join(' ');
		if (/^(?:(?:material:|evidence:|web:|paper:|source:|web-|passage:|Q\d+)|P\d+-[A-Z]\d+|\d+$)/u.test(id) || aliases.has(id)) throw Error('回答引用了未读取的来源或不明确的编号，未保存本次回复');
		return full;
	});
}

// Scope is owned by the application. Some compatible models echo the input
// context alongside the declared tool arguments; discard an exact echo before
// Pi validates the strict schema, but never let a model change the bound scope.
// All other arguments remain subject to the tool's ordinary schema validation.
export function workbenchToolArguments(name, args, {projectID = '', selectedSource = null} = {}) {
	if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('应用工具参数不完整，本轮未执行操作');
	const result = {...args};
	if (Object.hasOwn(result, 'projectID')) {
		if (result.projectID !== projectID) throw Error('工具要求切换研究项目，请先在界面选择对应项目');
		delete result.projectID;
	}
	if (Object.hasOwn(result, 'selectedSource')) {
		const value = result.selectedSource;
		if (value === null ? selectedSource !== null : !selectedSource || typeof value !== 'object' || Array.isArray(value)
			|| Object.entries(value).some(([key, item]) => !Object.hasOwn(selectedSource, key) || !sameContextValue(item,selectedSource[key]))) {
			throw Error('工具要求切换当前资料，请先在界面选择对应资料');
		}
		delete result.selectedSource;
	}
	return result;
}

function sameContextValue(left,right) {
	if(left===right)return true;if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
	if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>sameContextValue(value,right[index]));
	const keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&sameContextValue(left[key],right[key]));
}

// An explicit task must use the corresponding built-in function even when the
// model would otherwise answer conversationally. Only successful tool results
// advance this small workflow; ordinary questions and source explanations are
// still free to choose which read-only evidence tools they need.
export function workbenchToolChoice(mode, messages = []) {
	const completed = new Set(messages.filter(row => row.role === 'toolResult' && !row.isError).map(row => row.toolName));
	const pipeline = {materials: ['search_local_materials'], place: ['search_local_materials', 'place_material_in_assembly'], page:['read_assembly_context','insert_assembly_page'],page_place:['read_assembly_context','insert_assembly_page','read_cited_materials','place_cited_materials_on_page'],check:['check_assembly_evidence'], assembly: ['read_assembly_context'], search: ['search_public_papers'], evaluate: ['evaluate_experiment_plan'],
		organize: ['search_local_materials', 'suggest_material_topics'], layout: ['list_project_materials', 'suggest_material_order']}[mode] || [];
	return pipeline.find(name => !completed.has(name)) || null;
}

// Only deliberate upward scrolling at the home boundary enters the workbench.
// Ctrl+wheel remains zoom, and an editable/nested scrolling surface owns its input.
export function advanceHomeOverscroll(previous, { deltaY, now, atTop, blocked = false }) {
	if (!atTop || blocked || !Number.isFinite(deltaY) || deltaY >= 0) return { distance: 0, count: 0, at: now, enter: false };
	const current = previous && now - previous.at < 700 ? previous : { distance: 0, count: 0 };
	const distance = Math.min(200, current.distance + Math.min(100, -deltaY));
	const count = current.count + 1;
	return { distance, count, at: now, enter: distance >= 110 && count >= 2 };
}

export function validateMaterialOrder(value, materialIDs) {
	const allowed = new Set(materialIDs), seen = new Set();
	const order = Array.isArray(value?.order) ? value.order : [];
	for (const id of order) {
		if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) throw Error('素材顺序包含不存在或重复的素材，请重试');
		seen.add(id);
	}
	if (!order.length) throw Error('没有返回可用的素材顺序');
	// Unmentioned materials stay available. The suggestion never deletes an asset.
	return [...order, ...materialIDs.filter(id => !seen.has(id))];
}

export function mergeMaterialOrder(previous, suggested, allIDs) {
	const available = new Set(allIDs), moving = new Set(suggested);
	if (suggested.some(id => !available.has(id))) throw Error('部分素材已被移除，请重新整理顺序');
	const baseline = [...new Set([...previous, ...allIDs])].filter(id => available.has(id));
	const queue = suggested.slice();
	return baseline.map(id => moving.has(id) ? queue.shift() : id);
}

export function bindWorkbenchEvidence(reply, excerpts) {
	if (typeof reply?.text !== 'string' || !reply.text.trim()) throw Error('模型未返回实际研究回答');
	const evidence = [...new Set((Array.isArray(reply.evidence) ? reply.evidence : []).map(item => typeof item === 'string' ? item : item?.quoteID))];
	return evidence.map(id => {
		const excerpt = excerpts.find(item => item.quoteID === id);
		if (!excerpt) throw Error('回答引用了不存在的证据，未保存这次回答');
		return excerpt;
	});
}
