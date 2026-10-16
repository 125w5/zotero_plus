/* SPDX-License-Identifier: AGPL-3.0-or-later */
// No remote endpoint, configuration or credential is read. data: fixtures use
// the application's real sandbox fetch/Response and the production ES module.
describe('Offline native provider stream boundary', function () {
 this.timeout(20000);
 const E = Zotero.Research;
 const Transport = ChromeUtils.importESModule('chrome://zotero/content/research/shared/pi-chat-transport.mjs');
 const Pi = ChromeUtils.importESModule('chrome://zotero/content/research/vendor/pi-agent.mjs');
 const Chat = ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-completion.mjs');
 const Errors = ChromeUtils.importESModule('chrome://zotero/content/research/shared/provider-error.mjs');
 const frame = value => 'data: ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\r\n\r\n';
 const chunk = (delta, finish_reason = null) => ({choices: [{index: 0, delta, finish_reason}]});
 const wire = frame(chunk({content: '离线原生中文：σₘᵢₙ(J)>0，x²。'})) + frame(chunk({}, 'stop')) + frame('[DONE]');
 const fixture = 'data:text/event-stream;charset=utf-8,' + encodeURIComponent(wire);
 const report = {type: '原生 data: SSE 离线响应，真实应用 sandbox 与生产 ES module；不访问网络，不读配置或凭据', tests: []};
 let folder, entry;
 const safeFailure = error => {
  const allowed = new Set(['Error', 'TypeError', 'ReferenceError', 'SecurityError', 'InvalidStateError', 'ProviderResponseError']);
  const frames = [], pattern = /chrome:\/\/zotero\/content\/(?:xpcom\/research|research\/shared)\/(providers\.js|pi-chat-transport\.mjs|chat-completion\.mjs|provider-error\.mjs):(\d+)(?::(\d+))?/g;
  for (const match of String(error?.stack || '').matchAll(pattern)) if (frames.length < 8) frames.push({file: match[1], line: Number(match[2]), column: match[3] ? Number(match[3]) : null});
  return {name: allowed.has(error?.name) ? error.name : 'UnknownError', frames};
 };
 before(async () => {folder = PathUtils.join(Zotero.DataDirectory.dir, 'provider-offline-stream-acceptance'); await IOUtils.makeDirectory(folder, {ignoreExisting: true});});
 beforeEach(function () {entry = {name: this.currentTest.title};});
 afterEach(async function () {entry.state = this.currentTest.state; if (this.currentTest.err) entry.failure = safeFailure(this.currentTest.err); report.tests.push(entry); await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2));});

 it('decodes the real sandbox Response through the production Pi ES module without network', async () => {
  const streamFn = Transport.createPiChatStream({endpoint: 'https://offline.invalid/v1', config: {}, EventStream: Pi.AssistantMessageEventStream,
   request: (_url, _options, timeout, readResponse) => E.requestProvider(fixture, {}, Math.min(timeout, 5000), async response => {
    entry.headersAccepted = response.status === 200;
    entry.bodyPresent = !!response.body; entry.bodyReadable = typeof response.body?.getReader === 'function';
    try {return await readResponse(response);} catch (error) {entry.callbackFailure = safeFailure(error); throw error;}
   })});
  const stream = streamFn({id: 'offline-fixture', api: 'openai-completions', provider: 'offline', maxTokens: 100}, {messages: [{role: 'user', content: '离线受控测试'}], tools: []});
  for await (const _event of stream) { /* Exercise the actual Pi event consumer. */ }
  const result = await stream.result(); entry.stopReason = result.stopReason; entry.decoded = result.content?.[0]?.text === '离线原生中文：σₘᵢₙ(J)>0，x²。';
  assert.equal(result.stopReason, 'stop', '离线生产 Pi SSE reader 必须读完 sandbox Response'); assert.isTrue(entry.decoded);
 });

 it('decodes the same real sandbox Response through the production legacy completion ES module', async () => {
  const result = await E.requestProvider(fixture, {}, 5000, async response => {
   try {return await Chat.readChatCompletion(response, {stream: true});} catch (error) {entry.callbackFailure = safeFailure(error); throw error;}
  });
  assert.equal(result.text, '离线原生中文：σₘᵢₙ(J)>0，x²。'); assert.equal(result.finishReason, 'stop'); entry.decoded = true;
 });

 it('preserves a bounded HTTP diagnostic when the error body is a native sandbox Response', async () => {
  const fixtureError = 'data:application/json,' + encodeURIComponent(JSON.stringify({error: {code: 'unsupported_parameter', param: 'max_tokens', message: 'Unsupported parameter max_tokens'}}));
  const error = await E.requestProvider(fixtureError, {}, 5000, Errors.providerResponseError);
  assert.equal(error.name, 'ProviderRequestError'); assert.equal(error.providerStatus, 500); assert.equal(error.providerCode, 'unsupported_parameter'); assert.equal(error.providerParam, 'max_tokens'); entry.decoded = true;
 });

 it('executes one exact tool through native SSE identity snapshots in more than ten frames', async () => {
  const name = 'search_local_materials', id = 'gateway-stable-call', query = '按采集批次划分调制识别训练与测试，并仅用训练数据拟合预处理参数', argumentsJSON = JSON.stringify({query});
  const fragments = [...argumentsJSON]; assert.isAtLeast(fragments.length,10); entry.identityFrames = fragments.length;
  const firstWire = fragments.map(part => frame(chunk({tool_calls:[{index:0,id,type:'function',function:{name,arguments:part}}]}))).join('') + frame(chunk({},'tool_calls')) + frame('[DONE]');
  const replies = ['data:text/event-stream;charset=utf-8,' + encodeURIComponent(firstWire), fixture]; let requests = 0, calls = 0;
  const streamFn = Transport.createPiChatStream({endpoint:'https://offline.invalid/v1',config:{},EventStream:Pi.AssistantMessageEventStream,
   request: (_url,_options,timeout,readResponse) => {requests++; assert.isAtMost(requests,2); return E.requestProvider(replies.shift(),{},Math.min(timeout,5000),readResponse);}});
  const agent = new Pi.Agent({initialState:{model:{id:'offline-fixture',api:'openai-completions',provider:'offline',maxTokens:100},tools:[{name,label:'素材',description:'',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},
   async execute(callID,args) {calls++; assert.equal(callID,id); assert.deepEqual(args,{query}); return {content:[{type:'text',text:'受控离线素材'}]};}}]},streamFn});
  await agent.prompt('离线工具验收'); assert.equal(requests,2); assert.equal(calls,1); assert.equal(agent.state.messages.at(-1).stopReason,'stop'); entry.requests = requests; entry.toolCalls = calls;
 });
});
