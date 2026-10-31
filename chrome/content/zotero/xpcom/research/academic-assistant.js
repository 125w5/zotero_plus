/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const Policy=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-ai-policy.mjs');
 const journalParser=ChromeUtils.importESModule('chrome://zotero/content/research/shared/journal-context.mjs');
 const metricLabels=ChromeUtils.importESModule('chrome://zotero/content/research/shared/journal-metric-label.mjs');
 const journalContexts=new Map();
 E.journalContext=item=>{if(item?.isRegularItem?.()&&item.getField('publicationTitle'))return {journal:item.getField('publicationTitle'),kind:'published'};return journalContexts.get(item?.id)||{journal:'',kind:'unknown'};};
 const C=ChromeUtils.importESModule('chrome://zotero/content/research/shared/material-catalog.mjs');
 E.materialSourceInfo=m=>{
  let item;const pid=m.paperItemID||m.anchor?.paperItemID,aid=m.attachmentID||m.anchor?.attachmentID;
  try{if(pid)item=Zotero.Items.get(pid);if(!item&&aid)item=Zotero.Items.get(aid);if(Array.isArray(item))item=null;if(item?.isAttachment?.()&&item.parentID)item=Zotero.Items.get(item.parentID)||item;}catch(_){}
  let title=m.paperTitle||m.anchor?.paperTitle||'来源论文未录入',metric,journal='';
  try{if(item){title=(item.isAttachment()?E.journalContext(item).paperTitle:'')||item.getField('title')||title;journal=E.journalContext(item).journal;metric=E.currentMetric(item);}}catch(_){}
  const context=E.journalContext(item),options={submitted:context.kind==='submitted'};return {title,impact:metricLabels.journalMetricLabel(metric,options)||E.metricStatus?.(item)||'IF — 暂无期刊',impactDetail:metricLabels.journalMetricDetail(metric,options),metric,journalContext:context};
 };
 E.appendMaterialProvenance=(host,m)=>{
  const d=host.ownerDocument,line=d.createElementNS('http://www.w3.org/1999/xhtml','small'),title=d.createElementNS('http://www.w3.org/1999/xhtml','span'),impact=d.createElementNS('http://www.w3.org/1999/xhtml','span');
  line.className='material-provenance';title.className='source-paper-title';impact.className='source-impact';line.append(title,impact);host.append(line);
  const refresh=()=>{const info=E.materialSourceInfo(m);title.textContent=info.title;impact.textContent=metricLabels.journalMetricLabel(info.metric,{submitted:info.journalContext?.kind==='submitted'});impact.hidden=!impact.textContent;line.title=info.title+' · '+(info.impactDetail||info.impact);};refresh();
  const id=m.paperItemID||m.anchor?.paperItemID||m.attachmentID||m.anchor?.attachmentID;
  if(id)Zotero.Items.getAsync(id).then(async item=>{if(item?.isAttachment()&&item.parentID)item=await Zotero.Items.getAsync(item.parentID);if(line.isConnected)refresh();if(!item)return;await E.completePaperMetadata(item);await E.ensurePaperMetrics(item);if(line.isConnected)refresh();}).catch(e=>Zotero.debug(e.message));return line;
 };
 const EXPERIMENT_TAGS=[...C.TAGS,{name:'消融实验',aliases:['ablation','ablation study'],parent:'实验'},{name:'鲁棒性',aliases:['robustness','robust'],parent:'实验'},{name:'数据预处理',aliases:['preprocessing','pre-processing','normalization'],parent:'实验'},{name:'实验设置',aliases:['experimental setup','implementation details','experiment','experiments','experimental settings','simulation setup'],parent:'实验'},{name:'基线',aliases:['baseline','comparison'],parent:'实验'}];
 // Shared read-only store views for the passage index; never mutate them.
 const storeView=(...path)=>E.store.peek?E.store.peek(...path):E.store.get(...path);
 const passageRows=new Map(),searchTwins=new WeakMap();
 const copyPosition=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const detachPassage=m=>{if(!m)return m;const position=copyPosition(m.position);return {...m,position,anchor:m.anchor&&{...m.anchor,position:m.anchor.position===m.position?position:copyPosition(m.anchor.position)}};};
 let passageContextJob;
 E.preparePassageSearch=async()=>{
  if(passageContextJob)return passageContextJob.then(()=>E.preparePassageSearch());
  const indices=storeView('manuscriptIndex')||{},ids=Object.entries(indices).filter(([id,index])=>index.documentKey&&journalContexts.get(Number(id))?.documentKey!==index.documentKey).map(([id])=>Number(id));if(!ids.length)return;
  const job=(async()=>{const items=await Zotero.Items.getAsync(ids),parents=[...new Set(items.filter(Boolean).map(x=>x.parentID).filter(Boolean))];if(parents.length)await Zotero.Items.getAsync(parents);for(const attachment of items.filter(Boolean)){const index=indices[attachment.id],document=storeView('manuscriptDocuments',index.documentKey);if(!document)continue;const info=journalParser.journalFromDocument(document);info.attachmentID=attachment.id;info.fileVersion=index.pdfHash;info.documentKey=index.documentKey;journalContexts.set(attachment.id,info);journalContexts.set(attachment.parentID||attachment.id,info);}})();passageContextJob=job;try{return await job;}finally{if(passageContextJob===job)passageContextJob=null;}
 };
 // Paragraph rows are built once per indexed document. A keystroke searches
 // these rows instead of copying every cached PDF text; matches are returned
 // as detached copies.
 E.findPaperPassages=(query,{paperID,limit=8}={})=>{
  if(!String(query).trim())return [];const rows=[],index=storeView('manuscriptIndex')||{};
  for(const [aid,state] of Object.entries(index)){
   const attachment=Zotero.Items.get(Number(aid));if(!attachment||attachment.deleted)continue;const pid=attachment.parentID||attachment.id;if(paperID&&pid!==paperID)continue;
   const document=storeView('manuscriptDocuments',state.documentKey);if(!document){passageRows.delete(aid);continue;}
   let cached=passageRows.get(aid);
   if(!cached||cached.document!==document||cached.pid!==pid){cached={document,pid,rows:[]};for(const [i,p] of document.paragraphs.entries()){if(!p.sourceText?.trim()||p.sourceText.trim().length<45)continue;cached.rows.push({id:'passage-'+aid+'-'+i,title:p.section||'论文正文',sourceText:p.sourceText,paperItemID:pid,attachmentID:Number(aid),pageIndex:p.pageIndex,position:p.position,sourceVersion:document.pdfHash,sourceRecordID:'passage:'+state.documentKey+':'+i,kind:'paragraph',summary:'',anchor:{paperItemID:pid,attachmentID:Number(aid),pageIndex:p.pageIndex,position:p.position,sourceText:p.sourceText}});}passageRows.set(aid,cached);}
   for(const row of cached.rows)rows.push(row);
  }
  if(!paperID)for(const aid of passageRows.keys())if(!index[aid])passageRows.delete(aid);
  const available=E.manuscripts.filterAutomaticMaterials?.(rows,{forAI:true})||rows,byID=new Map(available.map(m=>[m.id,m])),twins=available.map(m=>{let twin=searchTwins.get(m);if(!twin){twin={...m,title:'',summary:''};searchTwins.set(m,twin);}return twin;}),seen=new Set(),out=[];
  for(const hit of C.searchMaterials(twins,query,{tags:[...EXPERIMENT_TAGS,...C.TAGS]})){if(out.length>=limit)break;const key=hit.m.attachmentID+':'+hit.m.pageIndex+':'+C.normalize(hit.m.sourceText);if(seen.has(key))continue;seen.add(key);out.push({...hit,m:detachPassage(byID.get(hit.m.id))});}
  return out;
 };
 E.materializePassage=async m=>{const {projectAnnotationProjectID,projectHighlights,highlights,annotationRevision,passageID,...source}=m;return (await E.manuscripts.publishMaterials([E.manuscripts.model.material(source)])).cards[0];};
 E.paperConversation=id=>E.store.get('paperConversations',id)||{turns:[],decisions:[],questions:[]};
 // All live surfaces read the same transcript. The old paper record remains a
 // migration source and a home for explicitly confirmed research decisions.
 E.openPaperConversation=async(item,{fresh=false,inheritFrom,activate=true}={})=>{
  const source=E.library.describe(item),paperID=item.parentID||item.id,S=E.workbenchConversations;
  if(!S)throw Error('共享研究对话尚未加载，请重启新版。');
  const fields={paperID,origin:'reader',title:(source.title||'论文讨论').slice(0,28),selectedSource:{...source,kind:'paper',paperItemID:paperID,stableID:'paper:'+paperID}};
  if(inheritFrom)return S.inherit(inheritFrom,fields);
  const legacy=E.paperConversation(paperID);
  if(legacy.turns?.length)await S.importLegacy('reader-paper:'+paperID,legacy.turns.flatMap(turn=>[
   {id:turn.id+'-question',role:'user',text:turn.question,at:turn.at},
   {id:turn.id+'-answer',role:'assistant',text:E.core.resultMarkdown(turn.record),sources:turn.record.sources||[],at:turn.at,...(turn.noteID?{savedNoteID:turn.noteID}:{})}
  ]),fields);
  return S.open(fields,{fresh,activate});
 };
 E.askPaperShared=async(item,question,onStatus=()=>{},options={})=>{
  Policy.assertResearchPrompt(question);question=String(question||'');if(!question.trim())throw Error('请输入研究问题。');
  const S=E.workbenchConversations,session=options.sessionID?S.get(options.sessionID):await E.openPaperConversation(item);
  if(!session)throw Error('研究对话已不可用，请重新选择。');
  if(!E.runWorkbenchTask)throw Error('Pi 研究助手尚未加载，请重启新版。');
  const history=cloneConversation(session.messages),paperID=item.parentID||item.id,source={...E.library.describe(item),kind:'paper',paperItemID:paperID,stableID:'paper:'+paperID};
  const mode=options.mode??session.mode??'auto',modelID=options.modelID??session.modelID??'',thinkingLevel=options.thinkingLevel??session.thinkingLevel??'off',executionMode=options.executionMode??session.executionMode??'auto';
  await S.select(session.id,{scope:{paperID}});
  await S.update(session.id,{draft:'',mode,modelID,thinkingLevel,executionMode},{origin:'academic'});
  await S.append(session.id,{role:'user',text:question,attachments:session.attachments||[],paperID},{origin:'academic'});
  const result=await E.runWorkbenchTask({prompt:question,mode,modelID,thinkingLevel,executionMode,onToolPermission:options.onToolPermission,onResearchQuestion:options.onResearchQuestion,projectID:session.projectID||'',sessionID:session.id,selectedSource:source,attachments:session.attachments||[],history,signal:options.signal,onProgress:onStatus});
  if(options.signal?.aborted)throw Error('已停止，本次回答未保存。');
  return S.append(session.id,{...result,role:'assistant',text:result.text,sources:result.sources||[],paperID},{origin:'academic'});
 };
 const cloneConversation=value=>JSON.parse(JSON.stringify(value||[]));
 // Compatibility for older callers: adapt the actual shared Pi answer to the
 // legacy result shape, without running or saving a second conversation.
 E.askPaper=async(item,question,onStatus=()=>{},options={})=>{
  const message=await E.askPaperShared(item,question,onStatus,options),sources=message.sources||[];
  return {id:message.id,question,at:message.at,sharedMessage:message,record:{id:message.id,at:message.at,model:message.model,sources,result:{sections:[{heading:'研究讨论',body:message.text,sources:sources.map(source=>source.id||source.stableID),quotes:[]}],questions:[]}}};
 };
 E.confirmPaperDecision=async(id,text)=>{await E.store.update(s=>{s.paperConversations||={};const c=s.paperConversations[id]||={turns:[],decisions:[],questions:[]};if(!c.decisions.some(x=>x.text===text))c.decisions.push({text,at:new Date().toISOString()});});};
 E.suggestPaperQuestions=item=>{const saved=E.paperConversation(item.id);if(saved.questions.length)return saved.questions.slice(0,3);const records=storeView('papers',E.core.paperKey(E.library.describe(item)),'records')||[];const questions=records.at(-1)?.result.questions;if(questions?.length)return questions.slice(0,3);return ['结合我的批注，这篇论文哪些结论需要进一步核验？','实验基线、消融和数据划分能否支持作者的结论？'];};
 ChromeUtils.importESModule('chrome://zotero/content/research/shared/paper-metadata.mjs').installPaperMetadata(E,{Zotero,IOUtils});

})(Zotero.Research);
