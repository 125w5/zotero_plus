/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Explicit opt-in only: bounded requests through the application's real Pi
// payload and existing provider. No settings, credentials or raw body are logged.
function researchProviderProbeFailure(error, Errors, requestIndex) {
 const names = new Set(['Error', 'AssertionError', 'TypeError', 'ReferenceError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'EncodingError', 'ProviderRequestError', 'ProviderTransportError', 'ProviderResponseError', 'AbortError', 'TimeoutError']);
 const codes = new Set(['', 'unsupported_parameter', 'invalid_parameter', 'context_length_exceeded', 'model_not_found', 'invalid_tool_schema', 'invalid_messages']);
 const params = new Set(['', 'model', 'messages', 'stream', 'tools', 'tool_choice', 'max_tokens', 'max_completion_tokens', 'reasoning_effort', 'thinking', 'stream_options', 'response_format']);
 const files = new Set(['providers.js', 'workbench-agent.js', 'artifacts.js', 'assets.js', 'pi-chat-transport.mjs', 'provider-error.mjs', 'pi-agent.mjs', 'Timer.sys.mjs']);
 const frames = [], pattern = /(?:chrome:\/\/zotero\/content\/(?:xpcom\/research|research\/shared|research\/vendor)\/|resource:\/\/gre\/modules\/)([A-Za-z0-9_.-]+\.(?:js|mjs)):(\d+)(?::(\d+))?/g;
 // Only trusted bundled filenames and numeric positions survive. No function
 // names, paths, URLs or arbitrary stack prefixes can enter the report.
 for (const match of String(error?.stack || '').matchAll(pattern)) if (files.has(match[1]) && frames.length < 8) frames.push({file: match[1], line: Number(match[2]), column: match[3] ? Number(match[3]) : null});
 return {...(Number.isInteger(requestIndex) ? {requestIndex} : {}), errorName: names.has(error?.name) ? error.name : 'UnknownError',
  status: Number.isInteger(error?.providerStatus) && error.providerStatus >= 400 && error.providerStatus <= 599 ? error.providerStatus : null,
  code: codes.has(error?.providerCode) ? error.providerCode : '', param: params.has(error?.providerParam) ? error.providerParam : '',
  message: Errors.safeProviderError(error) || '请求未完成，安全阶段诊断已保留', frames};
}
function researchProviderProbeResponse(response) {
 const type = String(response?.headers?.get?.('content-type') || '').toLowerCase();
 return {status: Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : null,
  contentType: /^text\/event-stream(?:\s*;|$)/.test(type) ? 'text/event-stream' : /^application\/json(?:\s*;|$)/.test(type) ? 'application/json' : 'other',
  bodyPresent: !!response?.body, bodyReadable: typeof response?.body?.getReader === 'function'};
}
describe('Configured provider single-request diagnostic',function(){
 this.timeout(150000);
 it('LIVE diagnoses the configured GPT-6 Luna chat payload without retrying',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderProbe',true)&&!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){this.skip();return;}
  const E=Zotero.Research,base=E.settings();assert.include(['gpt6luna','gpt-6-luna'],base.model,'此探针仅使用当前已配置 GPT-6 Luna，不更换模型');
  const prior=E.requestProvider,diagnostics=ChromeUtils.importESModule('chrome://zotero/content/research/shared/provider-error.mjs');
  const report={kind:'真实 provider 单次短请求（保持应用输出预算）',model:base.model,networkRequests:0,maxOutputTokens:null,parameters:[],toolCount:0,outcome:'pending'};
  let providerFailure,error;
  E.requestProvider=async(url,options,timeout,readResponse)=>{
   if(report.networkRequests>=1){report.outcome='single-request-budget';throw Error('已达到本轮处理上限，请缩小任务范围后继续');}
   const payload=JSON.parse(options.body);assert.equal(payload.model,base.model,'不能更换模型');
   report.maxOutputTokens=payload.max_tokens||payload.max_completion_tokens||null;
   report.parameters=Object.keys(payload).filter(key=>['model','messages','stream','tools','tool_choice','max_tokens','max_completion_tokens','reasoning_effort','thinking','stream_options'].includes(key));report.toolCount=payload.tools?.length||0;report.networkRequests++;
   try{return await prior(url,{...options,body:JSON.stringify(payload)},Math.min(timeout,120000),readResponse);}
   catch(value){const message=diagnostics.safeProviderError(value);providerFailure={status:Number.isInteger(value.providerStatus)?value.providerStatus:null,code:value.providerCode||'',param:value.providerParam||'',message:message||'请求未完成，请检查网络或接口设置'};report.outcome='provider-error';report.failure=providerFailure;throw value;}
  };
  try{
   const result=await E.runWorkbenchTask({prompt:'已给出的研究记录：训练与测试按采集批次分离，并在未知信道条件下评估调制识别。仅用一句中文解释其研究问题；不写论文正文，不需要检索或调用工具。',mode:'discuss',modelID:base.model,thinkingLevel:'medium'});
   assert.isAbove(result.text.length,0);report.outcome='success';report.answerLength=result.text.length;
  }catch(value){error=value;}
  finally{E.requestProvider=prior;assert.isAtMost(report.networkRequests,1);await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir,'provider-single-request-probe.json'),JSON.stringify(report,null,2));Zotero.debug('EasySch provider single-request diagnostic '+JSON.stringify(report));}
  if(providerFailure)assert.fail(providerFailure.message);
  if(report.outcome==='single-request-budget'){this.skip();return;}
  if(error)throw Error('受控短请求未完成，安全诊断已写入 provider-single-request-probe.json');
 });
});

// Opt in separately: reproduce a follow-up after the largest saved source
// collection. Only counts and parameter names reach the diagnostic artifact.
describe('Configured provider long-history diagnostic',function(){
 this.timeout(150000);
 it('LIVE accepts a greeting after a paper discussion with hundreds of excerpt anchors',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderLongHistoryProbe',true)){this.skip();return;}
  const E=Zotero.Research,base=E.settings(),Transport=ChromeUtils.importESModule('chrome://zotero/content/research/shared/pi-chat-transport.mjs'),Errors=ChromeUtils.importESModule('chrome://zotero/content/research/shared/provider-error.mjs');
  assert.include(['gpt6luna','gpt-6-luna'],base.model,'保留当前已配置模型');
  const fixturePath=PathUtils.join(Zotero.DataDirectory.dir,'provider-long-history-fixture.json');let session,fixtureUsed=false;
  if(await IOUtils.exists(fixturePath)){
   const value=JSON.parse(await IOUtils.readUTF8(fixturePath));assert.isArray(value.messages,'隔离fixture只有共享历史，不导入settings或凭据');assert.isAtMost(value.messages.length,500);if(value.modelID)assert.equal(value.modelID,base.model,'隔离fixture不改变当前模型');
   const fields=['id','stableID','materialID','sourceRecordID','title','label','paperTitle','coverage','paperItemID','attachmentID','pageIndex'];
   session={thinkingLevel:value.thinkingLevel||'off',messages:value.messages.map(row=>{assert.include(['user','assistant'],row.role);assert.isString(row.text);assert.isAtMost(row.text.length,100000);assert.isAtMost(row.sources?.length||0,5000);return {id:String(row.id||''),role:row.role,text:row.text,...(row.citedSourceIDs?{citedSourceIDs:row.citedSourceIDs.filter(id=>typeof id==='string')}:{}),sources:(row.sources||[]).map(source=>Object.fromEntries(fields.filter(field=>['string','number'].includes(typeof source[field])).map(field=>[field,source[field]])))};})};fixtureUsed=true;
  }else{
   const sessions=E.workbenchConversations.list();session=sessions.sort((a,b)=>Math.max(0,...(b.messages||[]).map(row=>row.sources?.length||0))-Math.max(0,...(a.messages||[]).map(row=>row.sources?.length||0)))[0];
  }
  const history=JSON.parse(JSON.stringify(session?.messages||[])),largest=Math.max(0,...history.map(row=>row.sources?.length||0));
  if(largest<100){this.skip();return;}
  const previous=E.requestProvider,report={kind:'真实 provider 一次问候；真实已保存长对话及至少100个来源锚点',model:base.model,fixtureUsed,history:{messageCount:history.length,sourceCount:history.reduce((n,row)=>n+(row.sources?.length||0),0),maximumSourcesPerMessage:largest},networkRequests:0,outcome:'pending'};let failure;
  E.requestProvider=async(url,options,timeout,readResponse)=>{
   if(report.networkRequests)throw Error('长历史探针不允许工具续轮或重试');const payload=JSON.parse(options.body);assert.equal(payload.model,base.model);assert.equal(payload.messages.at(-1).role,'user');assert.equal(JSON.parse(payload.messages.at(-1).content).question,'你好');report.request=Transport.chatRequestStats(payload);report.networkRequests++;
   try{return await previous(url,options,Math.min(timeout,120000),readResponse);}catch(error){report.failure={status:Number.isInteger(error.providerStatus)?error.providerStatus:null,code:error.providerCode||'',param:error.providerParam||'',message:Errors.safeProviderError(error)||'请求未完成'};throw error;}
  };
  try{const result=await E.runWorkbenchTask({prompt:'你好',mode:'discuss',modelID:base.model,thinkingLevel:session.thinkingLevel||'off',allowToolExecution:false,history});assert.isAbove(result.text.length,0);report.answerLength=result.text.length;report.outcome='success';}
  catch(error){failure=error;report.outcome='failed';}
  finally{E.requestProvider=previous;await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir,'provider-long-history-probe.json'),JSON.stringify(report,null,2));Zotero.debug('EasySch provider long-history diagnostic '+JSON.stringify(report));}
  assert.equal(report.networkRequests,1);if(failure)throw Error(report.failure?.message||'长历史问候未完成，安全数字诊断已保存');assert.equal(report.request.emptyMessageCount,0);assert.equal(report.request.invalidToolMessageCount,0);
 });
});

// A separate opt-in prevents an old single-request flag from spending another
// two requests. The active saved transcript is read without modifying it.
describe('Configured provider two-turn conversation diagnostic', function () {
 this.timeout(270000);
 it('LIVE sends two identical greetings with real shared history and no retry or model substitution', async function () {
  if (!Zotero.Prefs.get('extensions.easysch.liveProviderTwoTurnProbe', true)) { this.skip(); return; }
  const E = Zotero.Research, base = E.settings();
  assert.include(['gpt6luna', 'gpt-6-luna'], base.model, '此探针仅使用当前已配置 GPT-6 Luna');
  const Transport = ChromeUtils.importESModule('chrome://zotero/content/research/shared/pi-chat-transport.mjs'), errors = ChromeUtils.importESModule('chrome://zotero/content/research/shared/provider-error.mjs');
  const session = E.workbenchConversations.getActive(), history = JSON.parse(JSON.stringify(session?.messages || [])), previous = E.requestProvider;
  const report = { kind: '真实 provider 两轮相同问候；沿用共享历史与应用输出预算', model: base.model, networkRequests: 0, outcome: 'pending', history: { messageCount: history.length, userCount: history.filter(row => row.role === 'user').length, assistantCount: history.filter(row => row.role === 'assistant').length, sourceCount: history.reduce((count, row) => count + (row.sources?.length || 0), 0), maximumSourcesPerMessage: Math.max(0, ...history.map(row => row.sources?.length || 0)) }, turns: [] };
  let round, failure, lastAnswer;
  E.requestProvider = async (url, options, timeout, readResponse) => {
   if (!round || round.networkRequests >= 1 || report.networkRequests >= 2) throw Error('两轮探针不允许额外工具请求或重试');
   const payload = JSON.parse(options.body); assert.equal(payload.model, base.model, '不能更换模型');
   if (round.turn === 2) { assert.equal(payload.messages.at(-2)?.role, 'assistant'); assert.equal(payload.messages.at(-2)?.content, lastAnswer, '第二轮必须保留上一轮真实助手回答'); }
   round.request = Transport.chatRequestStats(payload); round.networkRequests++; report.networkRequests++;
   try { return await previous(url, options, Math.min(timeout, 120000), readResponse); }
   catch (error) { round.failure = { status: Number.isInteger(error.providerStatus) ? error.providerStatus : null, code: error.providerCode || '', param: error.providerParam || '', message: errors.safeProviderError(error) || '请求未完成，请检查网络或接口设置' }; throw error; }
  };
  try {
   for (let index = 0; index < 2; index++) {
    round = { turn: index + 1, networkRequests: 0, outcome: 'pending' }; report.turns.push(round);
    const result = await E.runWorkbenchTask({ prompt: '你好', mode: 'discuss', modelID: base.model, thinkingLevel: session?.thinkingLevel || 'off', history });
    assert.isAbove(result.text.length, 0); round.outcome = 'success'; round.answerLength = result.text.length; round.returnedSourceCount = result.sources?.length || 0;
    lastAnswer = result.text;
    history.push({ role: 'user', text: '你好' }, { role: 'assistant', text: result.text, sources: result.sources || [], model: result.model });
   }
   report.outcome = 'success';
  } catch (error) { failure = error; report.outcome = 'failed'; if (round) round.outcome = round.failure ? 'provider-error' : 'application-error'; }
  finally {
   E.requestProvider = previous;
   await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir, 'provider-two-turn-probe.json'), JSON.stringify(report, null, 2));
   Zotero.debug('EasySch provider two-turn diagnostic ' + JSON.stringify(report));
  }
  assert.isAtMost(report.networkRequests, 2);
  if (failure) throw Error(round?.failure?.message || '两轮请求未完成，安全诊断已写入 provider-two-turn-probe.json');
  assert.equal(report.networkRequests, 2); assert.isAtLeast(report.turns[1].request.roleCounts.assistant, 1);
 });
});

describe('Configured provider current-visual diagnostic',function(){
 this.timeout(150000);
 it('LIVE explains the real open-paper equation through the shared conversation in one request',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderEvidenceProbe',true)){this.skip();return;}
  const E=Zotero.Research,base=E.settings(),Errors=ChromeUtils.importESModule('chrome://zotero/content/research/shared/provider-error.mjs'),Formula=ChromeUtils.importESModule('chrome://zotero/content/research/shared/formula-research.mjs');
  assert.include(['gpt6luna','gpt-6-luna'],base.model);
  const previous=E.requestProvider,report={kind:'真实当前论文公式原图与相邻正文；一次请求，不换模型、不续轮',model:base.model,networkRequests:0,outcome:'pending',phase:'source-preparation'};
  let asset,item,failure;
  try{
   // Exercise the same background artifact service as import/preprocessing.
   // Do not initialize the whole UI or launch unrelated warmup requests.
   const pdfs=(await Zotero.Items.getAll(Zotero.Libraries.userLibraryID)).filter(pdf=>pdf.isPDFAttachment()&&!pdf.deleted);
   await Promise.all(pdfs.map(pdf=>pdf.loadDataType('itemData')));
   pdfs.sort((a,b)=>Number(/World.Model/i.test(b.getField('title')))-Number(/World.Model/i.test(a.getField('title'))));
   for(const pdf of pdfs){if(!await pdf.fileExists())continue;const indexed=await E.assets.index(pdf.id,()=>{});asset=indexed.assets.find(row=>row.kind==='formula');if(asset){item=pdf;break;}}
   if(!asset){report.outcome='no-equation';}
   else {
   report.source={attachmentID:item.id,pageIndex:asset.pageIndex,kind:asset.kind,hasRecognizedLatex:!!E.store.get('formulaTranscriptions',Formula.formulaSourceKey(asset))?.latex};
   report.phase='provider-request';
   E.requestProvider=async(url,options,timeout,read)=>{
    if(report.networkRequests)throw Error('公式详情探针不允许续轮或重试');
    const payload=JSON.parse(options.body);assert.equal(payload.model,base.model);const parts=payload.messages.at(-1).content;assert.isArray(parts);
    const data=JSON.parse(parts.find(row=>row.type==='text').text);assert.equal(data.currentVisualEvidence.pageIndex,asset.pageIndex);
    report.contextRows=data.currentVisualEvidence.sources.length;report.contextCharacters=data.currentVisualEvidence.sources.reduce((n,row)=>n+(row.text?.length||0),0);report.imageCount=parts.filter(row=>row.type==='image_url').length;
    report.parameters=Object.keys(payload).filter(key=>['model','messages','tools','stream','max_tokens','max_completion_tokens','reasoning_effort','thinking'].includes(key));report.networkRequests++;
    try{return await previous(url,options,Math.min(timeout,120000),async response=>{
     report.phase='provider-response';report.response=researchProviderProbeResponse(response);
     try{return await read(response);}catch(error){report.originalReadFailure=researchProviderProbeFailure(error,Errors,report.networkRequests);throw error;}
    });}catch(error){report.failure=researchProviderProbeFailure(error,Errors,report.networkRequests);throw error;}
   };
   const result=await E.runWorkbenchTask({prompt:'仅依据随本次请求给出的本文原式图片和相邻正文，解释这一式计算什么、符号及索引含义、在本篇文章中的作用。公式与变量请用LaTeX。不要调用工具，不写论文正文，原文未定义的符号不能猜测。',mode:'discuss',modelID:base.model,thinkingLevel:base.thinkingLevel||'off',allowToolExecution:false,selectedSource:{id:item.parentID||item.id,paperItemID:item.parentID||item.id,attachmentID:item.id,kind:'paper',title:asset.paperTitle,evidenceAsset:asset}});
   assert.isAbove(result.text.length,0);report.answerLength=result.text.length;report.citedSourceCount=result.citedSourceIDs?.length||0;report.outcome='success';report.phase='complete';
   }
  }
  catch(error){failure=error;report.outcome='failed';if(!report.failure)report.applicationFailure=researchProviderProbeFailure(error,Errors);}
  finally{E.requestProvider=previous;await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir,'provider-current-visual-probe.json'),JSON.stringify(report,null,2));Zotero.debug('EasySch provider current-visual diagnostic '+JSON.stringify(report));}
  if(report.outcome==='no-equation'){this.skip();return;}
  assert.isAtMost(report.networkRequests,1);if(failure)throw Error(report.failure?.message||'当前公式详情未完成，安全数字诊断已保存');assert.equal(report.networkRequests,1);assert.equal(report.imageCount,1);
 });
});

// One actual function-call/result loop, with synthetic local research material.
// The two calls are the normal Pi continuation, never a transport retry. No
// library, manuscript, conversation, settings or credentials are modified.
describe('Configured provider material-tool diagnostic', function () {
 this.timeout(270000);
 it('LIVE completes one real material-search tool loop with the selected model and no retries', async function () {
  if (!Zotero.Prefs.get('extensions.easysch.liveProviderTest', true)) { this.skip(); return; }
  const E = Zotero.Research, base = E.settings(); assert.include(['gpt6luna', 'gpt-6-luna'], base.model);
  const Errors = ChromeUtils.importESModule('chrome://zotero/content/research/shared/provider-error.mjs'), Transport = ChromeUtils.importESModule('chrome://zotero/content/research/shared/pi-chat-transport.mjs');
  const prior = {request: E.requestProvider, assets: E.manuscripts.assetLibrary, summary: E.manuscripts.summaryReader, summaryFor: E.manuscripts.summaryFor, prepare: E.preparePassageSearch, passages: E.findPaperPassages};
  const material = {id: 'provider-local-material-fixture', kind: 'paragraph', title: '调制识别数据划分验收记录', sourceText: '隔离验收研究记录：训练与测试按采集批次分离，先划分独立测试数据，再仅用训练数据拟合预处理参数。这是待核验的研究记录，不是真实实验结果。', summary: '调制识别的数据划分：按采集批次分离训练与测试，并使预处理只拟合训练数据。'};
  const report = {kind: '真实 provider 与真实 Pi；一次素材函数调用和结果续轮，数据为隔离验收研究记录', model: base.model, thinkingLevel: base.thinkingLevel || 'off', networkRequests: 0, localSearchCalls: 0, outcome: 'pending', requests: []};
  let failure;
  E.manuscripts.assetLibrary = () => ({[material.id]: material}); E.manuscripts.summaryReader = () => row => row.summary || ''; E.manuscripts.summaryFor = row => row.summary || '';
  E.preparePassageSearch = async () => {}; E.findPaperPassages = async query => {report.localSearchCalls++; report.queryCharacters = String(query).length; return [];};
  E.requestProvider = async (url, options, timeout, readResponse) => {
   if (report.networkRequests >= 2) throw Error('素材工具探针不允许额外工具请求、重试或模型替换');
   const payload = JSON.parse(options.body); assert.equal(payload.model, base.model);
   const row = Transport.chatRequestStats(payload); assert.equal(row.invalidToolMessageCount, 0); assert.equal(row.emptyMessageCount, 0);
   if (!report.networkRequests) {
    assert.deepEqual(payload.tool_choice, {type: 'function', function: {name: 'search_local_materials'}});
    report.forcedTool = payload.tool_choice.function.name;
   } else {
    assert.equal(payload.tool_choice, 'auto'); const assistant = payload.messages.findLast(value => value.role === 'assistant');
    assert.lengthOf(assistant.tool_calls, 1); const call = assistant.tool_calls[0]; assert.equal(call.function.name, 'search_local_materials');
    const args = JSON.parse(call.function.arguments); report.argumentFields = Object.keys(args); assert.deepEqual(report.argumentFields, ['query']);
    const tool = payload.messages.findLast(value => value.role === 'tool'); assert.equal(tool.tool_call_id, call.id);
    const result = JSON.parse(tool.content); assert.exists(result.materials.find(value => value.id === 'material:' + material.id)); report.readRecordCount = result.materials.length;
   }
   report.requests.push(row); report.networkRequests++;
   try {return await prior.request(url, options, Math.min(timeout, 120000), async response => {
    row.response = researchProviderProbeResponse(response);
    try {return await readResponse(response);} catch (error) {row.originalReadFailure = researchProviderProbeFailure(error, Errors, report.networkRequests); throw error;}
   });}
   catch (error) {report.failure = researchProviderProbeFailure(error, Errors, report.networkRequests); throw error;}
  };
  try {
   const result = await E.runWorkbenchTask({prompt: '请帮我推荐与“调制识别数据划分”相关的已有素材。只检索本机素材，不检索公开文献；仅根据实际工具结果给出两句推荐理由，并引用实际来源 ID，不写论文正文。', mode: 'auto', modelID: base.model, thinkingLevel: report.thinkingLevel});
   assert.isAbove(result.text.length, 0); assert.include(result.steps, '检索已有素材'); assert.exists(result.sources.find(value => value.stableID === 'material:' + material.id));
   report.answerLength = result.text.length; report.citedSourceCount = result.citedSourceIDs?.length || 0; report.outcome = 'success';
  } catch (error) {failure = error; report.outcome = report.failure ? 'provider-error' : 'application-error'; if (!report.failure) report.applicationFailure = researchProviderProbeFailure(error, Errors);}
  finally {
   E.requestProvider = prior.request; E.manuscripts.assetLibrary = prior.assets; E.manuscripts.summaryReader = prior.summary; E.manuscripts.summaryFor = prior.summaryFor; E.preparePassageSearch = prior.prepare; E.findPaperPassages = prior.passages;
   await IOUtils.writeUTF8(PathUtils.join(Zotero.DataDirectory.dir, 'provider-material-tool-probe.json'), JSON.stringify(report, null, 2));
   Zotero.debug('EasySch provider material-tool diagnostic ' + JSON.stringify(report));
  }
  assert.isAtMost(report.networkRequests, 2); if (failure) throw Error(report.failure?.message || '素材工具循环未完成，安全数字诊断已保存');
  assert.equal(report.networkRequests, 2); assert.equal(report.localSearchCalls, 1);
 });
});
