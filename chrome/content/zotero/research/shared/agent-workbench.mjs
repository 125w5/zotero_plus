/* SPDX-License-Identifier: AGPL-3.0-or-later */
import { assemblyTaskContext, assemblyBlockText } from '../manuscript/assembly-task-context.mjs';
import {writingPreparation} from './writing-framework.mjs';
import {writingWorkflowContext} from './paper-writing-workflow.mjs';
import {directionDecisions} from './assembly-direction.mjs';
export {assemblyTaskContext};
export {thinkingLabel,lowerThinkingLevel,lengthRequest} from './model-request.mjs';
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
	// Heavy tools run only on an explicit action or a chosen task. A question
	// that mentions 可行性/评估/排序 about a read paper stays a discussion and
	// works without a project.
	const explanation = /(解释|解读|翻译|概括|说明|是什么|什么是|如何理解|为什么|区别|原理|概念)/u.test(text);
	const aboutSource = /(?:这篇|该|这几篇|这些|几篇)(?:论文|文章|文献|研究|综述)|本文|原文|(?<![中英日])文中|作者|这个方法|该方法/u.test(text) && !/素材/u.test(text) && !/(?:我|我们)的|当前项目|本项目|这个(?:实验)?方案|这个(?:想法|构想|设想)/u.test(text);
	const planStart = '(?:^|[，,；;。])\\s*(?:请|帮我|为我|给我|我想|我要|然后|并|再)?\\s*';
	// The user's own idea is an evaluation object too: 评估这个想法的可行性,
	// 给我一个最小验证方案. The same words about a read paper stay a discussion.
	const planRequest = new RegExp(planStart + '(?:制定|设计|规划|生成|保存|建立).{0,24}(?:实验|方案|假设|预处理|鲁棒性|消融)', 'u').test(text)
		|| !aboutSource && new RegExp(planStart + '(?:评估|改进|优化|修改|完善|给出|提供).{0,24}(?:实验|方案|假设|预处理|鲁棒性|消融)|分析.{0,12}可行性|可行性分析', 'u').test(text)
		|| !aboutSource && new RegExp(planStart + '(?:(?:评估|验证).{0,24}?(?:可行性|想法|思路|构想|是否可行|能否成立)|(?:给出|提供|设计|制定|(?:一个|一份)).{0,12}?最小验证)', 'u').test(text);
	if (!aboutSource && /(整理|调整|梳理|优化|重排).{0,16}(布局|排布|排序|逻辑顺序|论证顺序)/u.test(text)) return 'layout';
	if (!aboutSource && /(设计|规划|梳理|安排).{0,20}(写作流程|论文装配流程|我要写的流程|论证流程|论文结构)/u.test(text)) return 'layout';
	if (!aboutSource && /(整理|归组|分类|合并).{0,12}(素材|主题|标签)|(素材|主题|标签).{0,12}(整理|归组|分类)/u.test(text)) return 'organize';
	const materialRequest = /(推荐|查找|检索|搜索|寻找|找|筛选|挑选|选出).{0,24}(已有|可用|可以使用|适合|相关)?[^。；;\n]{0,12}素材|素材.{0,16}(推荐|查找|检索|搜索|筛选|挑选)/u.test(text);
	if (materialRequest && (!explanation || /请|帮我|为我|我想|我要/u.test(text))
		&& !/(不要|不用|无需|不需要|别).{0,8}(推荐|查找|检索|搜索|寻找|找|筛选|挑选|选出)/u.test(text)) return 'materials';
	// Looking inside the open paper is not a public literature search.
	const insideSource = /(?:这篇|本|该)(?:论文|文章|文献)(?:中|里|内)|(?<![中英日])文中|原文中|本文中/u.test(text);
	if (!insideSource && (/(查找|检索|搜索|寻找|补充|搜集).{0,18}(论文|文献|资料)|有没有.{0,12}(论文|文献)/u.test(text)
		|| /推荐.{0,18}(论文|文献)/u.test(text) && (!explanation || /请|帮我|为我|我想|我要/u.test(text)))) return 'search';
	if (planRequest) return 'evaluate';
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

// 把这段素材精简一下，然后插入到引言章节: the insertion places the original;
// the edit becomes a 说明 proposal, never paper prose.
let MATERIAL_EDIT = /精简|压缩|缩短|缩写|简化|删减|改写|重写|润色|概括|提炼|改得|改成|改为|调整措辞|更简洁|更学术|规范表述/u;
export function materialEditIntent(prompt) {
	let text = String(prompt || '').normalize('NFKC');
	if (!requestsMaterialPlacement(text) || /(?:不要|不用|无需|不需要|别)[^。；;，,]{0,6}(?:精简|压缩|缩短|改写|重写|润色|修改|调整)/u.test(text)) return false;
	return MATERIAL_EDIT.test(text);
}
// The edit clauses alone, for the 说明 proposal: 插入到引言章节 is not an edit.
export function placementEditInstruction(prompt) {
	let text = String(prompt || '').normalize('NFKC').trim();
	let clauses = text.split(/[，,。；;！!\n]|然后|再把|之后|以后|并且/u).map(part => part.trim()).filter(Boolean);
	let edits = clauses.filter(part => MATERIAL_EDIT.test(part)).map(part => part.replace(/(?:后|再)?(?:插入|加入|放进|放入|放到|添加到|导入)[^，,。；;]*$/u, '').trim()).filter(Boolean);
	return (edits.join('，') || text).slice(0, 600);
}

// 引言 in 插入到引言章节 names the destination chapter. A title counts only right
// after an insertion verb, so 方法 in 把这份方法素材加入装配 describes the
// material and the bound position is kept. Numbering such as 1. / 第2章 / 一、
// is ignored; a 一 that begins a word such as 一致性 is not numbering.
let CHAPTER_NUMBER = /^(?:第[0-9一二三四五六七八九十百]+(?:章|节|部分)[、.．]?|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+)*(?:[.、．]|(?=[\s\p{Script=Han}]))|[IVX]{1,6}[.、．])/u;
let INSERT_VERB = '(?:插入|加入|放进|放入|放到|放在|添加到|添加|导入|拖进|拖入)(?:到|至|进|在)?';
export function promptedSectionID(project, prompt) {
	let text = String(prompt || '').normalize('NFKC').replace(/[\s“”‘’"'「」『』《》]+/gu, '').toLowerCase();
	if (!text) return '';
	let bare = title => String(title || '').normalize('NFKC').trim().replace(CHAPTER_NUMBER, '').replace(/[\s“”‘’"'「」『』《》]+/gu, '').toLowerCase();
	let named = row => {
		let title = bare(row.title);
		return title.length >= 2 && new RegExp(INSERT_VERB + '(?:' + CHAPTER_NUMBER.source.slice(1) + ')?' + title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu').test(text);
	};
	let hits = (project?.sections || []).filter(named);
	// 插入到实验结果 also contains 实验; two unrelated destinations name none.
	let best = hits.filter(row => !hits.some(other => other !== row && bare(other.title).length > bare(row.title).length && bare(other.title).includes(bare(row.title))));
	return best.length === 1 ? best[0].id : '';
}

// A length follow-up regenerates the latest preview with this requirement.
// Numbers, formulas and citations stay protected by the preview validators.
// A named limit is kept as written; a share of the current text is rounded,
// and a target that would not be shorter than the text is not stated. Only a
// request for shorter text (缩短, 再短一些) asks for less than a limit the
// candidate already meets.
let LENGTH_REQUIREMENT = /\s*【篇幅要求：[^】]*】$/u;
export function previewLength(text) {
	let length = String(text || '').replace(/\s+/gu, '').length;
	return length < 4 ? 0 : length;
}
export function shortenInstruction(base, request, currentText = '') {
	// The model sees the original text, not the candidate shown to the user, so
	// a rule relative to that candidate names its length.
	let length = previewLength(currentText), limit = Number(request?.limit) > 0 ? Math.floor(Number(request.limit)) : 0, met = limit && length && limit >= length;
	let share = length ? Math.round(length * (request?.ratio || 0.7)) : 0, shorter = request?.shorter !== false;
	let rule = limit && !met ? '缩短到' + limit + '字以内'
		: met && shorter ? '不超过' + limit + '字，且短于上一版的' + length + '字'
		: met ? '不超过' + limit + '字'
		: share >= 4 && share < length ? '缩短到约' + share + '字以内' : '比当前版本更短';
	let kept = String(base || '').replace(LENGTH_REQUIREMENT, '').trim();
	return ((kept ? kept + ' ' : '') + '【篇幅要求：' + rule + '；' + (met && !shorter ? '' : '只删去次要信息，') + '原有数字、单位、公式和引用保持不变】').slice(0, 1200);
}

// What a length follow-up refers to: the latest answer in the conversation.
// A 说明 proposal (in the message) or a selection or writing preview (in the
// project, by ID) can be regenerated; a 说明 proposal already accepted or
// declined is reported as settled. A plain answer gives null, so 太长了 after
// it goes to the discussion that wrote it. A regenerated preview carries
// previewInstruction, so a second 缩短 keeps the first edit.
export function latestConversationPreview(history = []) {
	let rows = Array.isArray(history) ? history : [], index = rows.findLastIndex(row => row?.role === 'assistant'), message = rows[index];
	if (!message) return null;
	let question = typeof message.previewInstruction === 'string' && message.previewInstruction ? message.previewInstruction : rows.slice(0, index).findLast(row => row?.role === 'user')?.text || '';
	let proposal = message.materialSummaryProposal;
	if (proposal?.kind === 'material-summary-proposal') return proposal.status === 'pending' ? {kind: 'material-summary', message, proposal, instruction: proposal.instruction || question} : {kind: 'settled', message, proposal};
	if (typeof message.selectionPreviewID === 'string' && message.selectionPreviewID) return {kind: 'selection', message, previewID: message.selectionPreviewID, instruction: question};
	if (typeof message.writingPreviewID === 'string' && message.writingPreviewID) return {kind: 'writing', message, previewID: message.writingPreviewID, instruction: question};
	return null;
}

// 说明 placeholders written by the summary pipeline are not editable text.
export function materialSummaryEditable(text) {
	let value = String(text || '').trim();
	return value.length >= 4 && !/^(?:正在整理中文说明|中文说明暂未完成)/u.test(value);
}

// The chat card for a 说明 proposal. It reuses the plan proposal card styles;
// accept and reject are the caller's, so nothing is written from here. The
// card keeps the outcome itself, so it is right before the transcript redraws.
let SUMMARY_STATUS = {accepted: '已采用为素材说明；原文和论文正文未改动', rejected: '未采用；素材说明保持原样', superseded: '已有更新的说明建议'};
export function renderMaterialSummaryProposal(host, proposal, {accept, reject, onError = () => {}} = {}) {
	if (proposal?.kind !== 'material-summary-proposal' || !Array.isArray(proposal.variants) || !proposal.variants.length) return null;
	let doc = host.ownerDocument;
	let create = (tag, cls, text) => {
		let node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
		node.className = cls || '';
		if (text !== undefined) node.textContent = text;
		return node;
	};
	if (!doc.querySelector('[data-plan-edit-proposal-style]')) {
		let link = create('link');
		link.rel = 'stylesheet';
		link.href = 'chrome://zotero/content/research/shared/plan-edit-proposal.css';
		link.dataset.planEditProposalStyle = 'true';
		(doc.head || doc.documentElement).append(link);
	}
	host.querySelector?.('.material-summary-proposal[data-proposal-id="' + proposal.id + '"]')?.remove();
	let root = create('section', 'plan-edit-proposal material-summary-proposal');
	root.dataset.proposalId = proposal.id;
	root.setAttribute('aria-label', '素材说明修改建议');
	host.append(root);
	let selected = proposal.variants.find(row => row.id === proposal.selectedVariantID) || proposal.variants[0], status = proposal.status, busy = false, problem = '';
	let render = () => {
		root.replaceChildren();
		let pending = status === 'pending', heading = create('header', 'plan-edit-proposal-heading');
		// The heading names the variant shown, so the choice is visible without tab styles.
		heading.append(create('strong', '', '素材说明 · ' + (proposal.materialTitle || '已插入的素材')), create('span', 'plan-edit-proposal-version', [proposal.sectionTitle, proposal.variants.length > 1 ? '方案：' + selected.label : ''].filter(Boolean).join(' · ')));
		root.append(heading);
		if (proposal.variants.length > 1 && pending) {
			let tabs = create('div', 'plan-edit-proposal-actions');
			for (let variant of proposal.variants) {
				let tab = create('button', '', variant.label);
				tab.type = 'button';
				tab.setAttribute('aria-pressed', String(variant.id === selected.id));
				tab.disabled = busy;
				tab.onclick = () => {
					selected = variant;
					render();
				};
				tabs.append(tab);
			}
			root.append(tabs);
		}
		let diff = create('div', 'plan-edit-proposal-diff');
		diff.append(create('del', '', proposal.before || '（空）'), create('ins', '', selected.text));
		root.append(diff);
		let line = create('p', 'plan-edit-proposal-status', busy ? '正在保存说明…' : problem || SUMMARY_STATUS[status] || '采用后只更新这份素材的说明；原文、来源和论文正文不变');
		line.setAttribute('role', 'status');
		root.append(line);
		if (!pending) return;
		let actions = create('div', 'plan-edit-proposal-actions'), use = create('button', 'plan-edit-proposal-accept', '采用为说明'), keep = create('button', 'plan-edit-proposal-keep', '不采用');
		use.type = keep.type = 'button';
		use.disabled = keep.disabled = busy;
		use.dataset.action = 'accept-material-summary';
		keep.dataset.action = 'reject-material-summary';
		let run = (action, outcome) => async () => {
			if (busy) return;
			busy = true;
			problem = '';
			render();
			try {
				if (typeof action !== 'function') throw Error('说明建议暂时无法保存，请在装配页的研究对话中操作');
				await action();
				status = outcome;
			}
			catch (error) {
				problem = error.message;
				onError(error);
			}
			finally {
				busy = false;
				if (root.isConnected) render();
			}
		};
		use.onclick = run(accept && (() => accept(selected.id)), 'accepted');
		keep.onclick = run(reject, 'rejected');
		actions.append(use, keep);
		root.append(actions);
	};
	render();
	return root;
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
	// These plans are live project data. Never accept an echoed or stale plan
	// from the chat request, or include another chapter's private writing plan.
	const preparation=writingPreparation(project),writingWorkflow=project.writingWorkflow&&section?writingWorkflowContext(project,section.id,{materialIDs:ids}):undefined;
	return {projectID: project.id, title: project.title, stage: value.stage, sectionID: section?.id || '', sectionTitle: section?.title || '',
		blockID: block?.id || '', blockType: block?.type || '', userText: raw.slice(0,8000), materialIDs: ids, currentTask: String(value.currentTask || '').replace(/\s+/gu,' ').trim().slice(0,50),preparation,...(writingWorkflow?{writingWorkflow}:{}),directionChoices:directionDecisions(project.directionDiscussion),...(actual.writingResult?{writingResult:actual.writingResult}:{})};
}

// Fullwidth brackets keep the marker out of later citation binding.
export const UNVERIFIED_CITATION = '［未核实引用］';

// Short [S#] handles replace long internal IDs in model-facing payloads; the
// application maps them back, so the model never copies a 64-hex key.
export function citationHandleRegistry() {
	let handles = new Map(), byHandle = new Map();
	return {
		assign(stableID) {
			if (typeof stableID !== 'string' || !stableID) return '';
			if (!handles.has(stableID)) {
				let handle = 'S' + (handles.size + 1);
				handles.set(stableID, handle);
				byHandle.set(handle, stableID);
			}
			return handles.get(stableID);
		},
		handleFor: stableID => handles.get(stableID) || '',
		resolve: value => byHandle.get(String(value || '').replace(/\s+/gu, '').toUpperCase()),
		get size() { return handles.size; },
	};
}

// Canonicalize only aliases of sources the application actually read. An
// unknown or ambiguous ID never acquires a source: it becomes a visible
// 未核实引用 marker and the rest of the answer is kept.
export function bindWorkbenchCitations(text, sourceRows, { handles = null, onUnverified = () => {} } = {}) {
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
	const handleLike = id => !!handles?.size && /^s\s*\d+$/iu.test(id);
	const resolve = id => {
		if (handleLike(id)) {
			let stable = handles.resolve(id);
			return stable && canonical.has(stable) ? stable : undefined;
		}
		return canonical.has(id) ? id : aliases.get(id) || undefined;
	};
	const sourceLike = id => /^(?:(?:material:|evidence:|web:|paper:|source:|web-|passage:|Q\d+)|P\d+-[A-Z]\d+|\d+$)/u.test(id) || aliases.has(id) || handleLike(id);
	const mark = () => { onUnverified(); return UNVERIFIED_CITATION; };
	const expand = id => {
		let range = id.match(/^s\s*(\d+)\s*[-–—~]\s*s?\s*(\d+)$/iu);
		if (range && handles?.size && Number(range[2]) >= Number(range[1]) && Number(range[2]) - Number(range[1]) <= 20) return Array.from({length: Number(range[2]) - Number(range[1]) + 1}, (_, index) => 'S' + (Number(range[1]) + index));
		return id.split(/[,，;；、]\s*/u).map(part => part.trim()).filter(Boolean);
	};
	return String(text || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\])*?(?<!\\)\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|`[^`\n]+`|\[([^\]\n]+)\]|［([^］\n]+)］|(?<![\w:/.\-])((?:evidence|material|passage):[A-Za-z0-9:_\-.]{6,})/gu, (full, ascii, wide, bare) => {
		if (bare !== undefined) {
			// A raw internal ID in prose: bind it when it is a read source,
			// never show the hash itself to the reader.
			let cleaned = bare.replace(/[.:\-_]+$/u, ''), tail = bare.slice(cleaned.length), stable = resolve(cleaned);
			return (stable ? '[' + stable + ']' : mark()) + tail;
		}
		const id = (ascii ?? wide)?.trim();
		if (id === undefined) return full;
		const numbers=referenceNumbers(id);if(numbers.length&&numbers.every(number=>paperReferences.has(number)))return full;
		const exact = resolve(id); if (exact) return '[' + exact + ']';
		const parts = expand(id);
		if (parts.length > 1) {
			// A plain numeric list ([0, 1]) is ordinary text, not a citation.
			if (parts.every(part => /^\d+$/u.test(part))) return full;
			if (!parts.some(part => resolve(part) || sourceLike(part))) return full;
			return parts.map(part => paperReferences.has(part) ? '[' + part + ']' : resolve(part) ? '[' + resolve(part) + ']' : sourceLike(part) ? mark() : '[' + part + ']').join(' ');
		}
		if (sourceLike(id)) return mark();
		return full;
	});
}

// Count unverified markers without changing the text.
export function unverifiedCitationCount(text) {
	return String(text || '').split(UNVERIFIED_CITATION).length - 1;
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

export function workbenchPipeline(mode) {
	return ({materials: ['search_local_materials'], place: ['search_local_materials', 'place_material_in_assembly'], page:['read_assembly_context','insert_assembly_page'],page_place:['read_assembly_context','insert_assembly_page','read_cited_materials','place_cited_materials_on_page'],check:['check_assembly_evidence'], assembly: ['read_assembly_context'], search: ['search_public_papers'], evaluate: ['evaluate_experiment_plan'],
		organize: ['search_local_materials', 'suggest_material_topics'], layout: ['list_project_materials', 'suggest_material_order']}[mode] || []).slice();
}

// An explicit task must use the corresponding built-in function even when the
// model would otherwise answer conversationally. Only successful tool results
// advance this small workflow; ordinary questions and source explanations are
// still free to choose which read-only evidence tools they need. A step whose
// execution failed, or whose arguments failed twice, is no longer forced: the
// run reports that tool's real error instead of looping until the turn cap.
export function workbenchToolChoice(mode, messages = [], failed = new Set()) {
	const completed = new Set(messages.filter(row => row.role === 'toolResult' && !row.isError).map(row => row.toolName));
	const next = workbenchPipeline(mode).find(name => !completed.has(name)) || null;
	if (!next) return null;
	const errors = messages.filter(row => row.role === 'toolResult' && row.isError && row.toolName === next).length;
	return failed?.has?.(next) || errors >= 2 ? null : next;
}

// The model sees answered turns only. A failed or stopped question stays in
// the saved transcript for retry, but never reaches the model as a dangling
// user turn, wherever it is: the reader passes history before appending the
// new question, so a failed question can be the last row. A retry resends
// that text as the prompt.
export function workbenchHistory(messages) {
	const rows = Array.isArray(messages) ? messages : [];
	return rows.filter((row, index) => row?.role !== 'user' || !row.failure && (index === rows.length - 1 || rows[index + 1]?.role !== 'user'));
}

// A small, saveable description of a failed answer. Messages come from the
// application's own vocabulary; raw provider text never reaches here.
export function workbenchFailure(error, { aborted = false, model = '', thinkingLevel = '', configuredModel = '' } = {}) {
	let message = String(error?.message || '研究任务未完成，请重试').slice(0, 2000);
	let level = String(error?.thinkingLevel || thinkingLevel || '');
	// runWorkbenchTask records whether the next lower level sends less
	// reasoning; older callers only know whether the level was above 标准.
	let lowerable = !!level && level !== 'off' && error?.canLowerThinking !== false;
	// A forced tool call cut off at the cap also spent the budget on reasoning.
	let outputLimit = error?.code === 'REASONING_BUDGET_EXHAUSTED' || /推理(?:预算|用尽)/u.test(message)
		|| (error?.code === 'OUTPUT_LIMIT' || /输出(?:长度)?上限/u.test(message)) && lowerable;
	let kind = 'error';
	if (aborted || error?.name === 'AbortError') kind = 'stopped';
	else if (error?.code === 'ROUTED_MODEL_UNAVAILABLE' || /当前配置的模型不可用|自动选择的(?:研究)?模型/u.test(message)) kind = 'model';
	else if (outputLimit) kind = 'reasoning';
	else if (/超时|超过(?:处理)?时长|没有开始回复|中断时间过长/u.test(message)) kind = 'timeout';
	// The model that actually ran, not the caller's preference: under 自动 the
	// surfaces pass an empty model, and an unrouted failure of the configured
	// model must not offer that same model as the fix.
	let usedModel = String(error?.usedModel || error?.routedModel || model || '');
	let fallback = String(error?.configuredModel || configuredModel || '');
	return {kind, message: kind === 'stopped' && !message.includes('停止') ? '已停止，本次回答未保存' : message,
		retryable: true, at: new Date().toISOString(),
		...(usedModel ? {model: usedModel} : {}), ...(level ? {thinkingLevel: level} : {}),
		...(kind === 'model' && fallback && usedModel && fallback !== usedModel ? { configuredModel: fallback } : {}),
		...(['reasoning', 'timeout'].includes(kind) && lowerable ? { lowerThinking: true } : {}),
		...(error?.partial && typeof error.partial === 'object' ? {partial: JSON.parse(JSON.stringify(error.partial))} : {})};
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
