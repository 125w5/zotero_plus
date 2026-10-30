/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Request shape per provider and effort. Reasoning tokens count against the
// output cap, so a cap sized for plain answers truncates reasoning answers.
let REASONING_HOSTS = new Set(['api.openai.com', 'openai.goldgom.top']);
// Reasoning tokens added on top of the caller's visible-output budget. A
// reasoning model sent no effort reasons at its default (medium) effort.
let REASONING_ALLOWANCE = { minimal: 4000, low: 8000, medium: 16000, high: 24000, xhigh: 40000 };
let LEVEL_LABELS = { off: '标准', minimal: '轻量', low: '轻量', medium: '深入', high: '充分', xhigh: '极高' };
let LOWER_LEVEL = { xhigh: 'high', high: 'medium', medium: 'low', low: 'off', minimal: 'off' };
// firstByte covers headers, idle restarts on every streamed chunk, total caps
// one request and run caps a multi-turn tool task. None is shorter than the
// previous single 120-150 s timer.
let TIMEOUTS = {
	off: { firstByte: 90000, idle: 45000, total: 240000, run: 480000 },
	minimal: { firstByte: 90000, idle: 45000, total: 240000, run: 480000 },
	low: { firstByte: 90000, idle: 45000, total: 240000, run: 480000 },
	medium: { firstByte: 120000, idle: 60000, total: 300000, run: 600000 },
	high: { firstByte: 150000, idle: 75000, total: 360000, run: 900000 },
	xhigh: { firstByte: 180000, idle: 90000, total: 600000, run: 1500000 },
};

function hostOf(endpoint) {
	try {
		return new URL(String(endpoint || '')).hostname;
	}
	catch {
		return '';
	}
}

export function reasoningHost(endpoint) {
	return REASONING_HOSTS.has(hostOf(endpoint));
}

export function defaultReasoningParameter(endpoint) {
	let host = hostOf(endpoint);
	return REASONING_HOSTS.has(host) ? 'reasoning_effort' : host === 'api.deepseek.com' ? 'thinking' : '';
}

export function reasoningModel(model) {
	let id = String(model || '').trim();
	return /^(?:o\d|gpt-(?:[5-9]|\d{2,}))/i.test(id) || /reasoner|thinking/i.test(id);
}

// Reasoning models spend output tokens on their default effort even when the
// request omits reasoning_effort.
export function reasoningActive(config = {}) {
	let level = config.thinkingLevel || 'off';
	if (config.reasoningParameter === 'thinking') return level !== 'off';
	if (config.reasoningParameter === 'reasoning_effort') return level !== 'off' || reasoningModel(config.model);
	return false;
}

// OpenAI reasoning models reject max_tokens. Gateways keep the parameter that
// is known to work for them unless the configuration names another one.
export function tokenParameter(config = {}) {
	if (['max_tokens', 'max_completion_tokens'].includes(config.maxTokensParameter)) return config.maxTokensParameter;
	return hostOf(config.endpoint) === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens';
}

export function reasoningAllowance(config = {}) {
	if (!reasoningActive(config)) return 0;
	return REASONING_ALLOWANCE[config.thinkingLevel] || REASONING_ALLOWANCE.medium;
}

// base is the visible-output budget the caller sized for its answer. Active
// reasoning gets its allowance on top, so it can no longer use up the share
// the answer needs.
export function outputTokenBudget(base, config = {}) {
	let visible = Number(base) > 0 ? Math.floor(Number(base)) : 6500, active = reasoningActive(config);
	let value = visible + reasoningAllowance(config);
	// DeepSeek documents 8K output without thinking and 64K with it.
	if (hostOf(config.endpoint) === 'api.deepseek.com') value = Math.min(value, active ? 64000 : 8192);
	return value;
}

// Reasoning hosts and models reject or ignore a fixed temperature; no request
// with thinking enabled sends one either.
export function allowsTemperature(config = {}) {
	if (REASONING_HOSTS.has(hostOf(config.endpoint)) || reasoningModel(config.model)) return false;
	return !config.thinkingLevel || config.thinkingLevel === 'off';
}

export function reasoningPayload(config = {}) {
	let level = config.thinkingLevel || 'off';
	if (config.reasoningParameter === 'reasoning_effort') return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(level) ? { reasoning_effort: level } : {};
	if (config.reasoningParameter === 'thinking') return { thinking: { type: level === 'off' ? 'disabled' : 'enabled' } };
	return {};
}

export function requestTimeouts(level = 'off') {
	return { ...(TIMEOUTS[level] || TIMEOUTS.off) };
}

export function thinkingLabel(level) {
	return LEVEL_LABELS[level] || LEVEL_LABELS.off;
}

export function lowerThinkingLevel(level) {
	return LOWER_LEVEL[level] || 'off';
}

// Lowering helps only when the next level sends less reasoning: a reasoning
// model lowered from 轻量 to 标准 falls back to its own default effort,
// DeepSeek keeps thinking on until 标准, and a host without a reasoning
// parameter sends none.
export function canLowerThinking(config = {}) {
	let level = config.thinkingLevel || 'off';
	if (level === 'off' || !Object.keys(reasoningPayload(config)).length) return false;
	let next = lowerThinkingLevel(level);
	if (config.reasoningParameter === 'thinking') return next === 'off';
	return next !== 'off' || !reasoningModel(config.model);
}

// A length stop names its cause, what was kept and one step that helps at the
// level that ran. Visible text far below its own budget means reasoning ran
// past its allowance. A request to shorten is never told to narrow its scope:
// without a target length it is asked for one, with one it gets a lower one.
export function outputLimitError(config = {}, { truncated = false, partialText = '', visibleTokens = 0, shorten = false, shortenLimit = null, partialKept = false, kept = '原有内容未改动' } = {}) {
	let level = config.thinkingLevel || 'off', lower = canLowerThinking(config), text = String(partialText || ''), visible = Number(visibleTokens) || 0;
	let reasoning = reasoningActive(config) && (!truncated || visible > 0 && text.trim().length < visible / 2);
	let cause = (reasoning ? '模型的推理用尽了本次输出预算，' : '模型达到输出长度上限，') + (truncated ? '本次结果不完整' : '没有返回结果');
	let saved = [truncated ? partialKept ? '已保留中断前的部分结果' : '不完整的结果未保存' : '', kept].filter(Boolean).join('，');
	let target = Number(shortenLimit) > 0 ? Math.max(10, Math.round(Number(shortenLimit) / 2)) : 0;
	let action = reasoning && lower ? '可降低思考强度（改为“' + thinkingLabel(lowerThinkingLevel(level)) + '”）后重试'
		: reasoning && config.reasoningParameter === 'thinking' ? '可把思考强度改为“标准”后重试'
		: reasoning && level === 'off' && config.reasoningParameter === 'reasoning_effort' ? '可把思考强度改为“轻量”后重试'
		: shorten && target ? '可把目标字数调低（如“控制在' + target + '字以内”）后重试'
		: shorten ? '可在要求中写明目标字数（如“控制在200字以内”）后重试' : '可缩小本次内容范围或分步生成';
	return Object.assign(new Error(cause + '；' + (saved ? saved + '。' : '') + action), { code: reasoning ? 'REASONING_BUDGET_EXHAUSTED' : 'OUTPUT_LIMIT', kind: reasoning ? 'reasoning' : 'output-limit',
		stopReason: 'length', partialText: text, thinkingLevel: level, canLowerThinking: lower });
}

// 缩短一点, 再短一些，控制在200字以内, 压缩到一半: a follow-up about the length
// of the previous result. It names a length and otherwise only points back
// (这段, 上一版) or softens the request; anything left over is a new task
// (写一段200字的摘要, 请用100字概述方法) or a topic (模型压缩), not a follow-up.
// 缩短 and 再短 ask for less than the text shown; 以内 and 控制在 cap it, and a
// text already within the cap meets them; a bare 改成300字 names a target that
// may be longer than the text.
let SHORTER_WORD = /缩短|缩减|删减|压缩|精简|简化|简短|简洁|减半|缩(?=到|成|至|为)|短一些|短一点|短点|短些|再短|更短|太长|过长|冗长|啰嗦|啰唆|罗嗦|太多|\bshorter\b|\bshorten\b|\bcondense\b|\btrim\b|\btoo long\b/iu;
let LENGTH_BOUND = /以内|之内|以下|(?:字|词|字符)内|不超过|不要超过|不多于|最多|至多|控制在|控制到|\bunder\b|\bwithin\b|\bat most\b|\bless than\b/iu;
let SHORTEN_WORD = new RegExp(SHORTER_WORD.source + '|篇幅', 'iu');
let SHORTEN_WORDS = new RegExp(SHORTEN_WORD.source, 'giu');
let LENGTH_COUNT = /(\d{1,5})\s*个?\s*(?:字符|汉字|字|词|words?|characters?|chars?)/giu;
let LENGTH_RATIO = /一半|二分之一|三分之一|三分之二|减半|50\s*%/gu;
let LENGTH_QUESTION = /[?？]|为什么|怎么|如何|是什么|多少|多长/u;
let SHORTEN_TOPIC = /(?:压缩|精简|简化)的?(?:感知|算法|方法|模型|网络|编码|格式|技术|率|比)/gu;
let LENGTH_TASK = /总结|概括|解释|翻译|分析|比较|对比|介绍|讲解|讲讲|说说|检索|查找|搜索|评估|插入|加入|放到|新增|素材库|摘要|写一|写个|写成|写出|回答|答复|答案|整篇|全文|每个|每段|所有/u;
let LENGTH_NEGATION = /(?:不要|不用|别|无需|不需要|不必)[^，,。；;]{0,6}(?:缩短|缩减|删减|压缩|精简|简化|再短|更短)/u;
// Longer words first, so 再来 is not read as 再 plus a leftover 来.
let LENGTH_FILLER = new RegExp(['请', '麻烦', '帮我', '帮忙', '给我', '为我', '能不能', '能否', '可以', '可否', '稍微', '稍', '略', '重新生成', '重新', '重来', '重写', '再来', '再', '更', '太', '一下', '一点', '一些', '一版', '一个', '点', '些', '把', '将', '让', '它', '这一段', '这一版', '这个', '这段', '这条', '这份', '上面的', '上面', '刚才的', '刚才', '上一条', '上一个', '上一版', '候选', '方案', '说明', '建议', '版本', '结果', '内容', '文字', '改', '弄', '变', '调整', '写', '篇幅', '长度', '字数', '输出', '不要超过', '不超过', '不多于', '最多', '至多', '超过', '以内', '以下', '之内', '内', '左右', '大约', '约', '控制在', '控制到', '到', '成', '为', '至', '在', '的', '了', '吧', '呢', '啊', '哦', '嘛', '呀', '吗']
	.sort((a, b) => b.length - a.length).join('|') + '|\\b(?:please|make|it|a|bit|more|under|within|less|than|at|most|to|the|this|that|version|down)\\b|[\\s,，。.!！;；:：、~～…"“”\'‘’()（）-]', 'giu');

// The last length named in a request, e.g. 200 in 再短一些，控制在200字以内.
export function lengthLimit(text) {
	let counts = [...String(text || '').normalize('NFKC').matchAll(LENGTH_COUNT)], value = counts.length ? Number(counts.at(-1)[1]) : null;
	return value !== null && value >= 4 && value <= 20000 ? value : null;
}

export function lengthRequest(prompt) {
	let text = String(prompt || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
	if (!text || text.length > 60 || LENGTH_QUESTION.test(text) || LENGTH_TASK.test(text) || LENGTH_NEGATION.test(text)) return null;
	if (text.replace(SHORTEN_TOPIC, '') !== text) return null;
	let limit = lengthLimit(text), ratio = /一半|二分之一|减半|50\s*%/u.test(text) ? 0.5 : /三分之二/u.test(text) ? 0.67 : /三分之一/u.test(text) ? 0.34 : null;
	if (limit === null && ratio === null && !SHORTEN_WORD.test(text)) return null;
	if (text.replace(LENGTH_COUNT, '').replace(LENGTH_RATIO, '').replace(SHORTEN_WORDS, '').replace(LENGTH_FILLER, '')) return null;
	// Without a length or a share, the request can only mean shorter.
	let shorter = SHORTER_WORD.test(text) || ratio !== null || limit === null;
	return { limit, ratio: limit === null && ratio === null ? 0.7 : ratio, shorter, bound: LENGTH_BOUND.test(text), text };
}

// Wording only: a failure after a request to shorten names a target length.
// A bare target such as 改成300字 may ask for more text, so it does not count.
export function asksShorter(text) {
	let value = String(text || '').normalize('NFKC').replace(SHORTEN_TOPIC, ''), request = lengthRequest(value);
	return !!(request && (request.shorter || request.bound)) || /缩短|缩减|删减|压缩|精简|简化|简短|简洁|更短|短一些|短一点|篇幅|字数|太长|\bshorter\b|\bshorten\b/iu.test(value);
}

// One shared request body for the non-Pi chat callers.
export function completionParameters(config = {}, baseTokens = 6500, { temperature } = {}) {
	return {
		...(temperature !== undefined && allowsTemperature(config) ? { temperature } : {}),
		[tokenParameter(config)]: outputTokenBudget(baseTokens, config),
		...reasoningPayload(config),
	};
}
