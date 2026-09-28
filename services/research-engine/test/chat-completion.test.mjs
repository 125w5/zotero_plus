import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequiresStreaming, readChatCompletion } from '../../../chrome/content/zotero/research/shared/chat-completion.mjs';

const streamed = (events, cuts) => {
	const bytes = new TextEncoder().encode(events);
	let start = 0;
	const chunks = cuts.map(end => {
		const part = bytes.slice(start, end); start = end; return part;
	});
	chunks.push(bytes.slice(start));
	return new Response(new ReadableStream({
		start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); }
	}), { headers: { 'Content-Type': 'text/event-stream' } });
};

test('only the supplied OpenAI-compatible gateway requires streaming by default', () => {
	assert.equal(chatRequiresStreaming('https://openai.goldgom.top/v1'), true);
	assert.equal(chatRequiresStreaming('https://api.deepseek.com/v1'), false);
	assert.equal(chatRequiresStreaming('https://example.com/v1'), false);
	assert.equal(chatRequiresStreaming('invalid'), false);
});

test('assembles UTF-8 SSE deltas split inside Chinese characters and line endings', async () => {
	const body = [
		': keep-alive\r\n\r\n',
		'data: {"choices":[{"delta":{"content":"科研"}}]}\r\n\r\n',
		'data: {"choices":[{"delta":{"content":"可用"},"finish_reason":"stop"}]}\r\n\r\n',
		'data: [DONE]\r\n\r\n'
	].join('');
	const snapshots = [];
	const result = await readChatCompletion(streamed(body, [1, 22, 57, 58, 66]), { stream: true, onText: text => snapshots.push(text) });
	assert.deepEqual(result, { text: '科研可用', finishReason: 'stop' });
	assert.deepEqual(snapshots, ['科研', '科研可用']);
});

test('rejects a truncated stream instead of applying an incomplete result', async () => {
	await assert.rejects(readChatCompletion(streamed('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', [5]), { stream: true }), /完成前中断/);
});

test('keeps ordinary JSON chat responses unchanged', async () => {
	const response = new Response(JSON.stringify({ choices: [{ message: { content: '连接正常' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
	assert.deepEqual(await readChatCompletion(response), { text: '连接正常', finishReason: 'stop' });
});
