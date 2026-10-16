// SPDX-License-Identifier: AGPL-3.0-or-later
// Narrow upstream adapter: no provider registration, SDK, proxy or Node transport.
export { EventStream, AssistantMessageEventStream, createAssistantMessageEventStream }
  from '@mariozechner/pi-ai/dist/utils/event-stream.js';
export { validateToolArguments } from '@mariozechner/pi-ai/dist/utils/validation.js';
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai/dist/utils/event-stream.js';

export function streamSimple(model) {
  const stream = createAssistantMessageEventStream();
  const error = {
    role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error', errorMessage: '研究助手尚未连接应用的 API 传输接口。', timestamp: Date.now()
  };
  stream.push({ type: 'error', reason: 'error', error });
  return stream;
}
