/* SPDX-License-Identifier: AGPL-3.0-or-later */

// This OpenAI-compatible gateway requires streaming even for callers that only
// need the completed answer. Other providers retain their existing defaults.
export const chatRequiresStreaming = endpoint => {
	try { return new URL(endpoint).hostname === 'openai.goldgom.top'; }
	catch { return false; }
};

const contentText = value => typeof value === 'string' ? value
	: Array.isArray(value) ? value.map(part => typeof part === 'string' ? part : part?.text || '').join('') : '';

export async function readChatCompletion(response, { stream = false, onText } = {}) {
	if (!stream) {
		const result = await response.json();
		if (result.error) throw new Error('模型返回错误，请检查服务状态');
		const choice = result.choices?.[0];
		return { text: contentText(choice?.message?.content), finishReason: choice?.finish_reason };
	}
	if (!response.body?.getReader) throw new Error('模型没有返回可读取的流');
	const reader = response.body.getReader(), decoder = new TextDecoder();
	let pending = '', dataLines = [], text = '', finishReason, done = false;
	const consume = () => {
		if (!dataLines.length) return;
		const payload = dataLines.join('\n'); dataLines = [];
		if (payload === '[DONE]') { done = true; return; }
		let event;
		try { event = JSON.parse(payload); }
		catch { throw new Error('模型流式响应无法解析'); }
		if (event.error) throw new Error('模型流式响应失败，请检查服务状态');
		const choice = event.choices?.[0];
		if (!choice) return;
		const delta = contentText(choice.delta?.content);
		if (delta) { text += delta; onText?.(text); }
		else if (!text && choice.message?.content) { text = contentText(choice.message.content); onText?.(text); }
		finishReason = choice.finish_reason || finishReason;
	};
	const line = raw => {
		const value = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
		if (!value) { consume(); return; }
		if (value.startsWith('data:')) dataLines.push(value.slice(5).trimStart());
	};
	try {
		while (true) {
			const chunk = await reader.read();
			pending += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
			let end;
			while ((end = pending.indexOf('\n')) >= 0) {
				line(pending.slice(0, end)); pending = pending.slice(end + 1);
			}
			if (chunk.done) break;
		}
		if (pending) line(pending);
		consume();
	}
	finally { reader.releaseLock(); }
	if (!done && !finishReason) throw new Error('模型响应在完成前中断');
	return { text, finishReason };
}
