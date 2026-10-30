/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Writing from '../../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as Framework from '../../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Direction from '../../../chrome/content/zotero/research/shared/assembly-direction.mjs';
import * as M from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as JsonStream from '../../../chrome/content/zotero/research/shared/json-stream.mjs';
import {requestAssemblyWritingPreview} from '../../../chrome/content/zotero/research/manuscript/assembly-writing-result.mjs';
const root=new URL('../../../chrome/content/zotero/xpcom/research/',import.meta.url),codes=await Promise.all(['ppt-studio-ai.js','manuscript-writing.js','manuscript-direction.js'].map(file=>readFile(new URL(file,root),'utf8')));
function fixture(){
 const p={id:'p',title:'独立测试',sections:[{id:'s',title:'结果'}],materials:[{id:'m',revision:1,kind:'note',title:'独立批次',sourceText:'Independent accuracy was 92% at 20 Hz.',anchor:{pageIndex:2}}],blocks:[{id:'b',type:'paragraph',sectionID:'s',text:'独立批次的准确率为 92%，采样率为 20 Hz。',materials:[{id:'m',revision:1,role:'primary'}],revision:1}],ui:{blockID:'b',sectionID:'s'},proposals:[]},requests=[];
 let persisted=structuredClone(p),afterResponse=()=>{},controlledReply;
 const E={manuscripts:{model:M,get:()=>structuredClone(persisted)},studio:{model:{}},assets:{key:JSON.stringify},store:{get:key=>key==='researchMaterials'?{}:null},settings:()=>({endpoint:'https://fixture.invalid/v1',model:'default-model',reasoningParameter:'reasoning_effort'}),core:{endpoint:v=>v.replace(/\/+$/u,'')},resolveModel:async config=>config,credentials:{get:async()=> 'fixture-key'},setTimeout,clearTimeout,aiProgress:(model,text)=>model+' '+text,
  runArtifactEngine:async input=>input.operation==='assets-cache-get'?{miss:true}:{},
  requestProvider:async(url,options,timeout,reader)=>{requests.push({url,body:JSON.parse(options.body)});const response=await reader({});afterResponse();return response;}
 };
 const imported={Policy,Writing};
 const ChromeUtils={importESModule:uri=>{if(uri.endsWith('/research-ai-policy.mjs'))return Policy;if(uri.endsWith('/assembly-writing-preview.mjs'))return Writing;if(uri.endsWith('/writing-framework.mjs'))return Framework;if(uri.endsWith('/assembly-direction.mjs'))return Direction;if(uri.endsWith('/topic-materials.mjs')||uri.endsWith('/material-content.mjs'))return {};if(uri.endsWith('/json-stream.mjs'))return JsonStream;if(uri.endsWith('/chat-completion.mjs'))return {chatRequiresStreaming:()=>false,readChatCompletion:async()=>({finishReason:'stop',text:JSON.stringify(controlledReply||{variants:[{label:'结果先行',text:'独立批次的准确率为 92%，采样率为 20 Hz；记录了测试条件。',quoteIDs:['W1','W2']},{label:'条件先行',text:'在 20 Hz 的采样条件下，独立批次的准确率为 92%。',quoteIDs:['W1','W2']}]})})};throw Error('Unknown import '+uri);}};
 const Zotero={Research:E,getMainWindow:()=>({AbortController}),Utilities:{randomString:()=> 'stable-fixture'}};
 for(const code of codes)vm.runInNewContext(code,{ChromeUtils,Zotero,URL,AbortController});
 return {p,E,requests,write:()=>persisted=structuredClone(p),read:()=>structuredClone(persisted),onResponse:fn=>afterResponse=fn,reply:value=>controlledReply=value};
}
test('real preview service inherits explicit model/reasoning and validates candidates without writing the project',async()=>{
 const f=fixture(),capture=Writing.captureWritingPreview(f.p),before=f.read();const result=await f.E.manuscripts.previewWriting('p',{capture,instruction:'请润色当前段落',modelID:'explicit-model',thinkingLevel:'high'});
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.model,'explicit-model');assert.equal(f.requests[0].body.reasoning_effort,'high');assert.match(f.requests[0].body.messages[0].content,/所有输出只是待用户选择的预览/);assert.doesNotMatch(f.requests[0].body.messages[0].content,/不得代写、续写、润色/);assert.equal(result.variants.length,2);assert.equal(result.status,'pending');assert.deepEqual(f.read(),before);
 const input=JSON.parse(f.requests[0].body.messages[1].content);assert.equal(input.readingCoverage.find(row=>row.sourceID==='m').truncated,false);assert.equal(input.evidenceExcerpts.find(row=>row.sourceID==='m').kind,'note');assert.match(f.requests[0].body.messages[0].content,/不得冒充原论文事实/);assert.equal(result.capture.sources[0].text,undefined);assert.match(result.capture.sources[0].textHash,/^sha256:/);
 assert.match(f.requests[0].body.messages[0].content,/解释与建议放在段落之外/);assert.match(f.requests[0].body.messages[0].content,/关键条件/);assert.match(f.requests[0].body.messages[0].content,/不输出AI身份说明、能力声明、道歉、免责模板/);assert.doesNotMatch(f.requests[0].body.messages[0].content,/写作速读的narrative|放入questions|status、planned/);
});
test('assembly prose uses the same language contract without framework fields and still rejects unread evidence',async()=>{
 const f=fixture();f.p.blocks[0].text='';f.write();const capture=Writing.captureWritingPreview(f.p),before=f.read();assert.equal(capture.mode,'assemble');
 const reply={variants:[{label:'指标先行',text:'独立批次准确率为 92%，采样率为 20 Hz。',quoteIDs:['W1']},{label:'条件先行',text:'在 20 Hz 的采样条件下，独立批次准确率为 92%。',quoteIDs:['W1']}]};f.reply(reply);
 const result=await f.E.manuscripts.previewWriting('p',{capture,modelID:'explicit-model'}),system=f.requests[0].body.messages[0].content,input=JSON.parse(f.requests[0].body.messages[1].content);
 assert.equal(input.mode,'assemble');assert.equal(result.variants.length,2);assert.match(system,/不输出AI身份说明、能力声明、道歉、免责模板/);assert.match(system,/实际不确定性、作者归属和论断强度仍须准确保留/);assert.doesNotMatch(system,/写作速读的narrative|放入questions|status、planned/);assert.deepEqual(f.read(),before);
 f.reply({...reply,variants:reply.variants.map(row=>({...row,quoteIDs:['W404']}))});await assert.rejects(f.E.manuscripts.previewWriting('p',{capture,modelID:'explicit-model'}),error=>error.code==='WRITING_EVIDENCE_GAP');assert.deepEqual(f.read(),before);
});
test('real service rejects a concurrently changed source after response instead of offering stale prose',async()=>{
 const f=fixture(),capture=Writing.captureWritingPreview(f.p);f.onResponse(()=>{f.p.materials[0].sourceText+=' Updated by user.';f.p.materials[0].revision++;f.write();});await assert.rejects(f.E.manuscripts.previewWriting('p',{capture,modelID:'explicit-model'}),/来源已变化/);assert.equal(f.read().proposals.length,0);assert.equal(f.read().blocks[0].text,f.p.blocks[0].text);
});
test('UI preview flow uses session settings and persists only candidate state, with automatic permission semantics',async()=>{
 const f=fixture(),events=[],U={p:f.p,A:f.E.manuscripts,conversations:{get:()=>({modelID:'session-model',thinkingLevel:'medium',executionMode:'auto'})},conversationSession:{id:'chat'},changed(){},applyPanels(){},closeChatRail(){},requestToolPermission:()=>{throw Error('Auto must not ask');}};
 const result=await requestAssemblyWritingPreview(U,{instruction:'请润色当前段落'},{persist:async()=>f.write(),changed:()=>{},status:value=>events.push(value)});
 assert.equal(f.requests[0].body.model,'session-model');assert.equal(f.requests[0].body.reasoning_effort,'medium');assert.equal(f.read().proposals[0].id,result.id);assert.equal(f.read().blocks[0].text,'独立批次的准确率为 92%，采样率为 20 Hz。');assert.equal(U.writingPreviewBusy,false);assert.ok(events.some(value=>value.includes('候选已准备')));
});
test('UI preview flow rejects swallowed storage failures and denies ask permission before any provider request',async()=>{
 const f=fixture(),U={p:f.p,A:f.E.manuscripts,conversationSession:{id:'chat',modelID:'session-model',thinkingLevel:'high',executionMode:'ask'},changed(){},requestToolPermission:async()=>false};
 await assert.rejects(requestAssemblyWritingPreview(U,{instruction:'润色当前段落'},{persist:async()=>f.write(),changed:()=>{}}),/未执行/);assert.equal(f.requests.length,0);assert.equal(f.p.proposals.length,0);
 U.conversationSession.executionMode='auto';await assert.rejects(requestAssemblyWritingPreview(U,{instruction:'润色当前段落'},{persist:async()=>{U.saveError=Error('disk failed');},changed:()=>{}}),/disk failed/);assert.equal(f.requests.length,0);assert.equal(f.p.proposals.length,0);
});
test('image requests still cannot enter the candidate-specific studio request',async()=>{
 const f=fixture();await assert.rejects(f.E.manuscripts.previewWriting('p',{instruction:'请生成一张图片'}),error=>error.code==='AI_IMAGE_GENERATION_DISABLED');assert.equal(f.requests.length,0);
});

test('draft preparation and chosen research directions remain data when their plan mentions drawing figures',async()=>{
 const f=fixture();f.p.researchPreparation={researchGoal:'验证独立批次准确率',resourceConstraints:'沿用现有记录',plan:{minimumValidation:'绘制误差曲线图',experiments:[{id:'e1',outputs:'生成流程图说明后续实验设计'}]}};f.p.directionDiscussion={signature:Direction.directionSignature(f.p),questions:Direction.validateDirectionQuestions({questions:[{question:'下一步验证什么？',options:['先验证基线','重新采样']},{question:'图表怎么安排？',options:['绘制误差曲线图','生成流程图']}] }),answers:{},index:0};for(const row of f.p.directionDiscussion.questions)Direction.saveDirectionAnswer(f.p.directionDiscussion,row.id,0,'保留计划，后续再生成流程图');f.write();const before=f.read();assert.throws(()=>Policy.assertWritingPreviewPrompt(JSON.stringify(f.p.researchPreparation)),error=>error.code==='AI_IMAGE_GENERATION_DISABLED','复现旧的拼接方案文本误判');
 const batch=await f.E.manuscripts.prepareDraft('p',{instruction:'按本章任务组织候选段落',modelID:'explicit-model'});assert.equal(batch.previews.length,1);const input=JSON.parse(f.requests[0].body.messages[1].content);assert.equal(input.instruction,'按本章任务组织候选段落');assert.equal(input.preparation.plan.minimumValidation,'绘制误差曲线图');assert.equal(input.preparation.plan.experiments[0].outputs,'生成流程图说明后续实验设计');assert.equal(input.directionChoices[1].choice,'绘制误差曲线图');assert.deepEqual(f.read(),before);
 await assert.rejects(f.E.manuscripts.prepareDraft('p',{instruction:'请绘制误差曲线图',modelID:'explicit-model'}),error=>error.code==='AI_IMAGE_GENERATION_DISABLED');assert.equal(f.requests.length,1,'当前明确的生图操作仍不能进入正文候选通道');
});

test('a changed feasibility preparation cannot produce a stale paragraph preview',async()=>{
 const f=fixture();f.p.researchPreparation={resourceConstraints:'两周内完成',plan:{minimumValidation:'先验证基线'}};f.write();const capture=Writing.captureWritingPreview(f.p);f.onResponse(()=>{f.p.researchPreparation.plan.minimumValidation='增加跨设备验证';f.write();});await assert.rejects(f.E.manuscripts.previewWriting('p',{capture,modelID:'explicit-model'}),/研究方案.*变化/);assert.equal(f.read().blocks[0].text,f.p.blocks[0].text);assert.equal(f.read().proposals.length,0);
});
test('writing digest service reads the selected preparation and protects it against a newer plan version',async()=>{
 const f=fixture();f.p.researchPreparation={planVersionID:'plan2',planVersionNumber:2,planStatus:'confirmed',resourceConstraints:'两周',plan:{minimumValidation:'先做独立批次对照'}};f.p.sections[0].writingPurpose='只报告实际指标，检查与预定验证的偏离';f.write();const capture=Framework.captureFramework(f.p),before=f.read();f.reply({nodes:[{purpose:'对应预定验证报告实际结果',claim:'独立批次准确率已记录，其他计划仍待实施。',status:'supported',quoteIDs:['W1'],authorBlockIDs:['b'],materialIDs:['m'],narrative:'已写正文报告独立批次指标，仍需检查与预定验证条件是否一致。',written:'记录实际准确率',planned:'补充条件核对',adjustment:'保留实际结果和计划的区分',questions:['其他验证是否完成？'],template:'报告指标与对照'}]});
 await f.E.manuscripts.previewFramework('p',{capture,modelID:'explicit-model'});const input=JSON.parse(f.requests[0].body.messages[1].content);assert.equal(input.preparation.planVersionID,'plan2');assert.equal(input.preparation.plan.minimumValidation,'先做独立批次对照');assert.equal(input.rule.userPurpose,'只报告实际指标，检查与预定验证的偏离');assert.deepEqual(f.read(),before);assert.ok(input.evidenceExcerpts.every(row=>!row.sourceID.startsWith('plan')));
 assert.match(f.requests[0].body.messages[0].content,/缺材料、待实施实验与核验任务放入questions/);assert.match(f.requests[0].body.messages[0].content,/研究对象、实际问题、机制、条件和论证任务/);
 f.onResponse(()=>{f.p.researchPreparation.planVersionID='plan3';f.write();});await assert.rejects(f.E.manuscripts.previewFramework('p',{capture,modelID:'explicit-model'}),/研究方案.*已改变/);assert.equal(f.read().blocks[0].text,before.blocks[0].text);
});
test('a local writing-digest request keeps the language and chapter contract within its selected unit',async()=>{
 const f=fixture(),capture=Framework.captureFramework(f.p),node={purpose:'报告独立批次指标',claim:'独立批次准确率已记录。',status:'supported',quoteIDs:['W1'],authorBlockIDs:['b'],materialIDs:['m'],narrative:'本段先交代独立批次和采样条件，再报告准确率，与同条件对照衔接。',written:'已写准确率与采样率',planned:'补充同条件对照',adjustment:'先交代条件再解释差异',questions:['同条件对照是否已实施？'],template:'报告指标与对照'};
 f.reply({nodes:[node]});const frame=await f.E.manuscripts.previewFramework('p',{capture,modelID:'explicit-model'});Framework.mergeFramework(f.p,capture,frame);f.write();const unitID=f.p.writingFrameworks.s.nodes[0].id,local=Framework.captureFramework(f.p,{unitIDs:[unitID]}),before=f.read();f.reply({nodes:[{...node,id:unitID,narrative:'本段先报告独立批次的采样条件与准确率，后续对照沿用同一条件组织比较。'}]});
 const result=await f.E.manuscripts.previewFramework('p',{capture:local,modelID:'explicit-model'}),request=f.requests[1].body,system=request.messages[0].content,input=JSON.parse(request.messages[1].content);
 assert.deepEqual(input.units.map(row=>row.id),[unitID]);assert.equal(input.rule.type,'结果');assert.match(system,/不输出AI身份说明、能力声明、道歉、免责模板/);assert.match(system,/缺材料、待实施实验与核验任务放入questions/);assert.match(system,/必须逐一返回相同id/);assert.equal(result.nodes[0].id,unitID);assert.deepEqual(f.read(),before);
});
test('whole-digest review receives concrete language guidance and keeps selectable validated options',async()=>{
 const f=fixture(),capture=Framework.captureFrameworkReview(f.p),before=f.read(),reply={summary:'结果段已记录独立批次指标，尚需说明对照关系。',issues:[{sectionID:'s',unitID:'',problem:'结果段没有交代用于比较准确率的同条件基线。',options:['在结果段后补入同条件基线及差值','保留独立批次描述，删除与其他方法比较的论断']}]};f.reply(reply);
 const result=await f.E.manuscripts.previewFramework('p',{capture,review:true,modelID:'explicit-model'}),system=f.requests[0].body.messages[0].content;
 assert.match(system,/不输出AI身份说明、能力声明、道歉、免责模板/);assert.match(system,/必要的适用条件、实际不确定性、作者归属和论断强度/);assert.match(system,/不是全文原始论文，不声称核验全部事实/);assert.match(system,/方案写明具体调整位置、动作与取舍/);assert.doesNotMatch(system,/写作速读的narrative|放入questions|status、planned/);assert.equal(result.issues[0].options.length,2);assert.deepEqual(f.read(),before);
 f.reply({...reply,issues:[{...reply.issues[0],sectionID:'unread-section'}]});await assert.rejects(f.E.manuscripts.previewFramework('p',{capture,review:true,modelID:'explicit-model'}),/未知位置/);assert.deepEqual(f.read(),before);
});
