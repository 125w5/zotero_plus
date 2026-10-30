/* SPDX-License-Identifier: AGPL-3.0-or-later */
// OpenAI-compatible Chat Completions transport for the pinned Pi event stream.
// This module only serializes protocol data. Application tools remain in Pi.
import {safeProviderError} from './provider-error.mjs';
const MESSAGES = {
	protocol: '模型流式响应格式不完整，请重试',
	incomplete: '模型响应在完成前中断，请重试',
	arguments: '模型返回的工具参数不完整，未执行本轮工具，请重试',
	lengthTool: '模型达到输出上限，工具参数尚未完成，未执行本轮工具；原有内容未改动，可重试',
	filtered: '模型未完成本次回答，请调整问题后重试',
	limit: '已达到本轮处理上限（模型调用轮次已满），本次任务已停止',
	budget: '本轮研究任务已超过处理时长上限，已停止；可重试或降低思考强度',
	network: '无法连接服务，请检查网络或代理',
	aborted: '已停止，本次未完成内容不会写入',
	configuration: '模型传输配置不完整，请检查接口设置',
	messages: '对话消息格式不完整，本轮未发送，请重新提交问题',
	scope: '模型工具参数与当前项目或资料不一致，本轮未执行操作，请先选择需要的资料',
};
class TransportFailure extends Error {
	constructor(code) { super(MESSAGES[code] || MESSAGES.protocol); this.code = code; }
}
const fail = code => { throw new TransportFailure(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = parts => typeof parts === 'string' ? parts : (parts || []).filter(part => part.type === 'text').map(part => String(part.text || '')).join('');
const imageOf = part => ({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } });
const REQUEST_PARAMETERS = new Set(['model', 'messages', 'stream', 'tools', 'tool_choice', 'max_tokens', 'max_completion_tokens', 'reasoning_effort', 'thinking', 'temperature', 'stream_options']);
// Numeric structure only: no prompts, answers, source titles, URLs, tool
// arguments, headers or credentials can enter a diagnostic report.
export function chatRequestStats(payload) {
	const rows = Array.isArray(payload?.messages) ? payload.messages : [], roleCounts = { system: 0, user: 0, assistant: 0, tool: 0 };
	let textCharacters = 0, imageCount = 0, toolCallCount = 0, longestMessageCharacters = 0, emptyMessageCount=0,invalidToolMessageCount=0;const pendingCalls=new Set();
	for (const row of rows) {
		if (Object.hasOwn(roleCounts, row.role)) roleCounts[row.role]++;
		let characters = 0;
		if (typeof row.content === 'string') characters = row.content.length;
		else if (Array.isArray(row.content)) for (const part of row.content) {
			if (part?.type === 'text' && typeof part.text === 'string') characters += part.text.length;
			else if (part?.type === 'image_url') imageCount++;
		}
		textCharacters += characters; longestMessageCharacters = Math.max(longestMessageCharacters, characters);
		toolCallCount += Array.isArray(row.tool_calls) ? row.tool_calls.length : 0;
		if(!characters&&!row.tool_calls?.length&&!(Array.isArray(row.content)&&row.content.some(part=>part?.type==='image_url')))emptyMessageCount++;
		if(row.role==='assistant')for(const call of row.tool_calls||[])pendingCalls.add(call.id);
		if(row.role==='tool'){if(!pendingCalls.delete(row.tool_call_id))invalidToolMessageCount++;}
	}
	invalidToolMessageCount+=pendingCalls.size;
	return { messageCount: rows.length, roleCounts, textCharacters, longestMessageCharacters, imageCount, toolCallCount,
		emptyMessageCount,invalidToolMessageCount,
		toolCount: Array.isArray(payload?.tools) ? payload.tools.length : 0,
		maxOutputTokens: Number(payload?.max_tokens || payload?.max_completion_tokens) || null,
		requestBytes: new TextEncoder().encode(JSON.stringify(payload || {})).byteLength,
		parameters: Object.keys(payload || {}).filter(key => REQUEST_PARAMETERS.has(key)) };
}
function safeError(error, signal) {
	if (signal?.aborted || error?.name === 'AbortError') return MESSAGES.aborted;
	if (error instanceof TransportFailure) return error.message;
	const known = String(error?.message || '');
	// requestProvider already sanitizes these messages. Never include raw provider
	// errors, request payloads, URLs, headers or credentials in UI/transcripts.
	const diagnostic=safeProviderError(error);if(diagnostic)return diagnostic;
	if (/^服务返回 HTTP \d{3}$/.test(known)
		|| ['服务请求已取消', '服务请求超时，请重试', MESSAGES.network].includes(known)) return known;
	return MESSAGES.network;
}
function chatMessages(context, config) {
	const messages = [], images = [];
	const flushImages = () => { if (images.length) messages.push({ role: 'user', content: images.splice(0) }); };
	if (context.systemPrompt) messages.push({ role: 'system', content: String(context.systemPrompt) });
	for (const message of context.messages || []) {
		if (message.role !== 'toolResult') flushImages();
		if (message.role === 'user') {
			const content = typeof message.content === 'string' ? message.content : (message.content || []).flatMap(part =>
				part.type === 'text' ? [{ type: 'text', text: String(part.text || '') }] : part.type === 'image' ? [imageOf(part)] : []);
			if(typeof content==='string'?!content.trim():!content.length)fail('messages');messages.push({ role: 'user', content });
		}
		else if (message.role === 'assistant') {
			const content = Array.isArray(message.content) ? message.content : [];
			const calls = content.filter(part => part.type === 'toolCall').map(part => {
				if (!part.id || !part.name || !object(part.arguments)) fail('arguments');
				return { id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.arguments) } };
			});
			const row = { role: 'assistant', content: textOf(message.content) || (calls.length ? null : '') };
			if(!calls.length&&!row.content.trim())fail('messages');
			if (calls.length) row.tool_calls = calls;
			if (config.reasoningParameter === 'thinking') row.reasoning_content = content.filter(part => part.type === 'thinking').map(part => part.thinking || '').join('');
			messages.push(row);
		}
		else if (message.role === 'toolResult') {
			if (!message.toolCallId) fail('protocol');
			messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: textOf(message.content) });
			for (const part of message.content || []) if (part.type === 'image') images.push(imageOf(part));
		}
	}
	flushImages();
	return messages;
}
function chatTools(tools) {
	const names = new Set();
	return (tools || []).map(tool => {
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name || '') || names.has(tool.name) || !object(tool.parameters)) fail('configuration');
		names.add(tool.name);
		return { type: 'function', function: { name: tool.name, description: String(tool.description || ''), parameters: tool.parameters } };
	});
}
const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
function toolIdentity(current, incoming, complete, names) {
	if (typeof incoming !== 'string' || !incoming) return current;
	if (!current) return incoming;
	// Some compatible gateways repeat the complete id/name beside each argument
	// delta. These identity snapshots are metadata, not text to concatenate.
	if (incoming === current) {
		// A repeated short name fragment can still be a real fragment if only
		// its concatenation is a prefix of a declared tool (e.g. a + a -> aa).
		if (!complete && names && [...names].some(name => name.startsWith(current + incoming))) return current + incoming;
		return current;
	}
	if (complete) fail('arguments'); // A bound call cannot silently change identity.
	return incoming.startsWith(current) ? incoming : current + incoming;
}
function usageOf(usage) {
	const cached = Math.min(count(usage.prompt_tokens_details?.cached_tokens), count(usage.prompt_tokens));
	return { input: count(usage.prompt_tokens) - cached, output: count(usage.completion_tokens), cacheRead: cached, cacheWrite: 0,
		totalTokens: count(usage.total_tokens) || count(usage.prompt_tokens) + count(usage.completion_tokens),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

/**
 * request(url, fetchOptions, timeoutMs, readResponse) is supplied by Zotero.
 * EventStream is Pi.AssistantMessageEventStream. No tool execute functions,
 * endpoint discovery, credential lookup or provider SDKs are used here.
 * chooseTool(context) may bind a required application workflow step; returning
 * null keeps ordinary automatic tool selection. normalizeToolArguments only
 * removes application-approved context echoes before Pi's schema validation.
 */
export function createPiChatStream({ request, endpoint, key, config = {}, EventStream, onProgress = () => {}, onDiagnostics = () => {},
	chooseTool = () => null, normalizeToolArguments = (_name, args) => args, maxTurns = 8 }) {
	if (typeof request !== 'function' || typeof EventStream !== 'function') throw new TransportFailure('configuration');
	const url = String(endpoint || '').replace(/\/+$/, '');
	const budget = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : 8;
	let turns = 0, explainedReasoning = false;
	// config.timeouts {firstByte,idle,total,run}: run is a wall-clock budget
	// across every turn of one task; each request also gets its own limits.
	let limits = object(config.timeouts) ? config.timeouts : null, deadline = limits && Number(limits.run) > 0 ? Date.now() + Number(limits.run) : 0;
	const progress = text => { try { Promise.resolve(onProgress(text)).catch(() => {}); } catch (_) { /* UI callbacks cannot break transport. */ } };
	return (model, context, options = {}) => {
		const stream = new EventStream(), signal = options.signal;
		const message = { role: 'assistant', content: [], api: model?.api || 'openai-completions', provider: model?.provider || 'easysch-configured', model: model?.id || '',
			usage: usageOf({}), stopReason: 'stop', timestamp: Date.now() };
		let ended = false, reader;
		const finishError = error => {
			if (ended) return;
			ended = true;
			message.stopReason = signal?.aborted || error?.name === 'AbortError' ? 'aborted' : 'error';
			message.errorMessage = safeError(error, signal);
			// An incomplete tool response must never survive as an executable call.
			message.content = message.content.filter(part => part.type !== 'toolCall');
			stream.push({ type: 'error', reason: message.stopReason, error: message });
			stream.end(message);
		};
		const cancel = () => {
			finishError(Object.assign(new Error(), { name: 'AbortError' }));
			try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch (_) { /* Already closed. */ }
		};
		stream.push({ type: 'start', partial: message });
		signal?.addEventListener('abort', cancel, { once: true });
		// Pi needs the EventStream immediately so it can subscribe and abort while
		// the application request is still awaiting headers.
		void Promise.resolve().then(async () => {
			if (signal?.aborted) { cancel(); return; }
			if (++turns > budget) fail('limit');
			if (deadline && deadline - Date.now() < 15000) fail('budget');
			if (!/^https?:\/\//i.test(url) || !model?.id) fail('configuration');
			const payload = { model: config.model || model.id, messages: chatMessages(context, config), stream: true };
			const tools = chatTools(context.tools);
			const toolNames = new Set(tools.map(tool => tool.function.name));
			const requiredTool = chooseTool(context);
			if (requiredTool && !tools.some(tool => tool.function.name === requiredTool)) fail('configuration');
			if (tools.length) { payload.tools = tools; payload.tool_choice = requiredTool ? { type: 'function', function: { name: requiredTool } } : 'auto'; }
			const tokens = Number(options.maxTokens || config.maxTokens || model.maxTokens);
			if (Number.isFinite(tokens) && tokens > 0) payload[config.maxTokensParameter === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens'] = Math.floor(tokens);
			if (config.streamUsage === true) payload.stream_options = { include_usage: true };
			const reasoning = options.reasoning || config.thinkingLevel || 'off';
			if (config.reasoningParameter === 'reasoning_effort') {
				if (['minimal', 'low', 'medium', 'high', 'xhigh'].includes(reasoning)) payload.reasoning_effort = reasoning;
			}
			else if (config.reasoningParameter === 'thinking') payload.thinking = { type: reasoning === 'off' ? 'disabled' : 'enabled' };
			else if (reasoning !== 'off' && !explainedReasoning) {
				explainedReasoning = true;
				progress('当前接口未声明思考参数支持，本轮未发送思考强度参数');
			}
			const stats=chatRequestStats(payload);
			try { Promise.resolve(onDiagnostics({ requestIndex: turns, ...stats })).catch(() => {}); } catch (_) { /* Diagnostics cannot alter requests. */ }
			if(stats.invalidToolMessageCount)fail('messages');
			let finishReason = null, sawDone = false, textIndex = -1, thinkingIndex = -1, touch = () => {};
			const calls = new Map();
			let timeout = Number(config.timeout) > 0 ? Number(config.timeout) : 120000;
			if (limits) {
				let total = Math.min(Number(limits.total) || timeout, deadline ? deadline - Date.now() : Infinity);
				timeout = { firstByte: Math.min(Number(limits.firstByte) || total, total), idle: Number(limits.idle) || 0, total };
			}
			const emitText = (kind, delta) => {
				if (typeof delta !== 'string' || !delta) return;
				let index = kind === 'text' ? textIndex : thinkingIndex;
				if (index < 0) {
					index = message.content.length;
					message.content.push(kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '', thinkingSignature: 'reasoning_content' });
					if (kind === 'text') textIndex = index; else thinkingIndex = index;
					stream.push({ type: kind + '_start', contentIndex: index, partial: message });
				}
				const field = kind === 'text' ? 'text' : 'thinking';
				message.content[index][field] += delta;
				if (message.content[index][field].length > 2000000) fail('protocol');
				stream.push({ type: kind + '_delta', contentIndex: index, delta, partial: message });
			};
			const handleFrame = data => {
				if (ended || sawDone) return;
				if (data.trim() === '[DONE]') { sawDone = true; return; }
				let chunk;
				try { chunk = JSON.parse(data); } catch (_) { fail('protocol'); }
				if (!object(chunk) || chunk.error) fail('protocol');
				if (chunk.usage) { if (!object(chunk.usage)) fail('protocol'); message.usage = usageOf(chunk.usage); }
				if (typeof chunk.id === 'string') message.responseId = chunk.id;
				if (typeof chunk.model === 'string') message.responseModel = chunk.model;
				if (!Array.isArray(chunk.choices)) fail('protocol');
				if (chunk.choices.some(row => !object(row))) fail('protocol');
				const choice = chunk.choices.find(row => row.index === 0) || (chunk.choices.length === 1 && chunk.choices[0].index == null ? chunk.choices[0] : null);
				if (!choice) return; // Usage-only chunks have an empty choices array.
				const delta = choice.delta || {};
				if (!object(delta) || (delta.tool_calls != null && !Array.isArray(delta.tool_calls))) fail('protocol');
				if (finishReason && (delta.content || delta.reasoning_content || delta.tool_calls?.length)) fail('protocol');
				if (delta.content || delta.reasoning_content || delta.tool_calls?.length) touch();
				emitText('thinking', delta.reasoning_content);
				emitText('text', delta.content);
				for (const part of delta.tool_calls || []) {
					if (!object(part)) fail('protocol');
					if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 64 || (part.type && part.type !== 'function')) fail('protocol');
					let call = calls.get(part.index);
					if (!call) {
						call = { id: '', name: '', identityBound: false, rawArguments: '', contentIndex: message.content.length };
						calls.set(part.index, call);
						message.content.push({ type: 'toolCall', id: '', name: '', arguments: {} });
						stream.push({ type: 'toolcall_start', contentIndex: call.contentIndex, partial: message });
					}
					call.id = toolIdentity(call.id, part.id, call.identityBound);
					call.name = toolIdentity(call.name, part.function?.name, toolNames.has(call.name), toolNames);
					if (call.id && toolNames.has(call.name)) call.identityBound = true;
					if (typeof part.function?.arguments === 'string') call.rawArguments += part.function.arguments;
					if (call.rawArguments.length > 256000 || call.id.length > 256 || call.name.length > 64) fail('arguments');
					Object.assign(message.content[call.contentIndex], { id: call.id, name: call.name });
					stream.push({ type: 'toolcall_delta', contentIndex: call.contentIndex, delta: part.function?.arguments || '', partial: message });
				}
				if (choice.finish_reason != null) {
					if (finishReason && finishReason !== choice.finish_reason) fail('protocol');
					finishReason = choice.finish_reason;
				}
			};
			const send = readResponse => request(/\/chat\/completions$/.test(url) ? url : url + '/chat/completions', {
				method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
				body: JSON.stringify(payload), signal,
			}, timeout, readResponse);
			const tokenKey = 'max_completion_tokens' in payload ? 'max_completion_tokens' : 'max_tokens', baseTokens = Number(config.tokenBase);
			// A cap raised for reasoning may exceed a model's own limit. Retry
			// once at the caller's base cap and say so; nothing else changes.
			const sendWithCap = async readResponse => {
				try { return await send(readResponse); }
				catch (error) {
					if (signal?.aborted || error?.providerCode !== 'invalid_parameter' || error?.providerParam !== tokenKey || !(baseTokens > 0) || !(payload[tokenKey] > baseTokens)) throw error;
					payload[tokenKey] = Math.floor(baseTokens);
					progress('接口不接受放宽后的输出上限，已按原上限重试');
					return send(readResponse);
				}
			};
			await sendWithCap(async (response, activity) => {
				if (ended) return;
				if (typeof activity === 'function') touch = activity;
				if (response.ok === false) fail('protocol');
				const contentType = response.headers?.get?.('content-type') || '';
				if (contentType && !/text\/event-stream/i.test(contentType)) fail('protocol');
				if (!response.body?.getReader) fail('protocol');
				reader = response.body.getReader();
				const decoder = new TextDecoder('utf-8', { fatal: true });
				let buffer = '', data = [];
				const line = value => {
					if (!value) { if (data.length) handleFrame(data.join('\n')); data = []; return; }
					if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
				};
				const drain = eof => {
					let start = 0;
					for (let i = 0; i < buffer.length; i++) {
						if (buffer[i] !== '\n' && buffer[i] !== '\r') continue;
						if (buffer[i] === '\r' && i === buffer.length - 1 && !eof) break;
						line(buffer.slice(start, i));
						if (buffer[i] === '\r' && buffer[i + 1] === '\n') i++;
						start = i + 1;
					}
					buffer = buffer.slice(start);
					if (buffer.length + data.reduce((sum, part) => sum + part.length, 0) > 2000000) fail('protocol');
					if (eof) { if (buffer) line(buffer); buffer = ''; line(''); }
				};
				try {
					while (!ended && !sawDone) {
						const next = await reader.read();
						if (ended) return;
						if (next.done) { buffer += decoder.decode(); drain(true); break; }
						buffer += decoder.decode(next.value, { stream: true }); drain(false);
					}
				}
				finally {
					try { await reader.cancel(); } catch (_) { /* Closed body. */ }
					try { reader.releaseLock(); } catch (_) { /* Cancelled read. */ }
					reader = null;
				}
			});
			if (ended) return;
			if (!sawDone || !finishReason) fail('incomplete');
			if (!['stop', 'length', 'tool_calls'].includes(finishReason)) fail('filtered');
			if (finishReason === 'length' && calls.size) fail('lengthTool');
			if ((finishReason === 'tool_calls') !== !!calls.size) fail('protocol');
			// Wire indices define tool order even if their deltas arrive interleaved.
			// Keep the existing content slots so text/thinking indices stay stable.
			const orderedCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
			const slots = orderedCalls.map(call => call.contentIndex).sort((a, b) => a - b);
			const blocks = orderedCalls.map(call => message.content[call.contentIndex]);
			orderedCalls.forEach((call, index) => { call.contentIndex = slots[index]; message.content[slots[index]] = blocks[index]; });
			const ids = new Set();
			for (const call of orderedCalls) {
				if (!call.id || ids.has(call.id) || !/^[A-Za-z0-9_-]{1,64}$/.test(call.name) || (toolNames.size && !toolNames.has(call.name))) fail('arguments');
				if (requiredTool && call.name !== requiredTool) fail('arguments');
				ids.add(call.id);
				let args;
				try { args = JSON.parse(call.rawArguments); } catch (_) { fail('arguments'); }
				if (!object(args)) fail('arguments');
				try { args = normalizeToolArguments(call.name, args); } catch (_) { fail('scope'); }
				if (!object(args)) fail('arguments');
				message.content[call.contentIndex].arguments = args;
			}
			if (textIndex >= 0) stream.push({ type: 'text_end', contentIndex: textIndex, content: message.content[textIndex].text, partial: message });
			if (thinkingIndex >= 0) stream.push({ type: 'thinking_end', contentIndex: thinkingIndex, content: message.content[thinkingIndex].thinking, partial: message });
			for (const call of orderedCalls) stream.push({ type: 'toolcall_end', contentIndex: call.contentIndex, toolCall: message.content[call.contentIndex], partial: message });
			message.stopReason = finishReason === 'tool_calls' ? 'toolUse' : finishReason;
			if (message.stopReason === 'length') progress(textIndex >= 0 && message.content[textIndex].text.trim() ? '模型达到输出上限，已保留本次回答，可继续讨论' : '模型的推理用尽了输出预算，没有返回回答');
			ended = true;
			stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(message);
		}).catch(finishError).finally(() => signal?.removeEventListener('abort', cancel));
		return stream;
	};
}
