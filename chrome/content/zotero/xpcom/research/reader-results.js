/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const quickJobs=new WeakMap(),translationCache=new Map();
 E.quickTranslate=async(text,signal)=>{const key=E.assets.key([text,'zh-CHS','youdao-v1']);if(translationCache.has(key))return {...translationCache.get(key),cacheHit:true};const saved=E.store.get().translationCache?.[key];if(saved){translationCache.set(key,saved);return {...saved,cacheHit:true};}const result=await E.translateYoudao(text,'zh-CHS',{signal});if(signal?.aborted)throw Error('已取消');translationCache.set(key,result);await E.store.update(s=>{s.translationCache||={};s.translationCache[key]=result;const keys=Object.keys(s.translationCache);for(const k of keys.slice(0,Math.max(0,keys.length-200)))delete s.translationCache[k];});return {...result,cacheHit:false};};
 E.selectionTranslationRecord=(selection,translation)=>({id:'translation-'+Date.now(),at:new Date().toISOString(),model:translation?'有道智云 · 机器翻译':'原文摘录',mode:'translate',warnings:[],sources:[{id:'S1',...selection,label:'选段原文',uri:E.library.uri(Zotero.Items.get(selection.attachmentID),selection.pageIndex)}],result:{sections:[{heading:translation?'选段译文':'原文摘录',body:translation?.text||selection.text,sources:['S1'],claim_type:'observation'}],keywords:[],questions:[]}});
 E.saveSelectionTranslation=async(selection,translation)=>E.saveReaderNote(selection,E.selectionTranslationRecord(selection,translation));
 E.renderQuickTranslation=({reader,doc,selection,append})=>{
  quickJobs.get(reader)?.abort();const controller=new doc.defaultView.AbortController();quickJobs.set(reader,controller);
  const box=doc.createElement('div');box.className='easysch-quick-translation';box.style.cssText='padding:10px 12px;margin-top:8px;border-top:1px solid #8b929833;line-height:1.65;color:inherit;max-width:480px;user-select:text';
  const output=doc.createElement('div');output.setAttribute('role','status');output.textContent='正在翻译…';output.style.cssText='max-height:220px;overflow:auto;white-space:pre-wrap;font-size:13px';
  const note=doc.createElement('button');note.textContent='保存高亮与笔记';note.className='easysch-reader-note';note.style.cssText='font:inherit;margin-top:8px;padding:6px 12px;border:1px solid #8b929855;border-radius:8px;background:transparent;color:inherit;cursor:pointer';box.append(output,note);append(box);let translation;
  note.onclick=async()=>{note.disabled=true;try{const saved=await E.saveSelectionTranslation(selection,translation);note.textContent='已保存 · 撤销';note.disabled=false;note.onclick=async()=>{note.disabled=true;try{await saved.undo();note.textContent='已撤销';}catch(e){output.textContent=e.message;note.disabled=false;}};}catch(e){output.textContent=e.message;note.disabled=false;}};
  const tools=doc.createElement('span');tools.style.cssText='display:inline-flex;gap:6px;margin-left:6px';box.append(tools);
  const action=(label,fn)=>{const b=doc.createElement('button');b.textContent=label;b.style.cssText=note.style.cssText;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){output.textContent=e.message;}finally{b.disabled=false;}};tools.append(b);return b;};
  action('AI 笔记',()=>E.runReaderText(reader,doc,selection,'AI 学术笔记','selection_explain'));
  action('批注',()=>E.annotateSelection(reader,selection,'highlight'));
  action('划掉',()=>E.annotateSelection(reader,selection,'strikeout'));
  const popup=box.closest('.selection-popup');if(popup){popup.style.width='min(480px,80vw)';popup.style.maxWidth='80vw';}
  E.setTimeout(async()=>{if(controller.signal.aborted||!box.isConnected)return;try{translation=await E.quickTranslate(selection.text,controller.signal);if(controller.signal.aborted||!box.isConnected)return;output.textContent=translation.text;output.title=translation.cacheHit?'已复用机翻缓存':'有道机器翻译';}catch(e){if(!controller.signal.aborted&&box.isConnected)output.textContent='机翻暂不可用：'+e.message;}},180);
 };
 const jobs=new WeakMap();
 E.runReaderText=async(reader,doc,selection,label,mode,{onRecord=()=>{},onStatus=()=>{}}={})=>{
  if(jobs.has(reader)){jobs.get(reader).show();return;}
  const card=E.readerResultCard(reader,doc,selection,label);
  const run=async()=>{try{
   jobs.set(reader,card);card.show();
   card.status('正在读取选段…');
   const paper=await Zotero.Items.getAsync(selection.paperID);
   const record=await E.ai.run({mode,papers:[E.library.describe(paper)],selection,onStatus:text=>{card.status(text);onStatus(text);}});
   card.render(record);onRecord(record);
  }catch(error){card.error(error,run);}finally{jobs.delete(reader);}};
  await run();
 };
 E.installReaderContext=()=>{E.readerContextHandler=({reader,append})=>{
  const selection=E.readerSelection(reader);if(!selection)return;
  for(const [type,label]of [['highlight','高亮选区'],['underline','下划线'],['strikeout','划掉文字（红色删除线）']])append({label,onCommand:()=>E.annotateSelection(reader,selection,type)});
  append({label:'图片区域保存为笔记',onCommand:()=>E.selectionImageNote(reader,selection).catch(e=>Zotero.logError(e))});
  append({label:'保存高亮与笔记',onCommand:()=>E.saveSelectionTranslation(selection).catch(e=>Zotero.logError(e))});
  append({label:'关联其他文献语句…',onCommand:()=>E.openSentenceLinker(reader,selection)});
  if(E.pendingSentence&&E.pendingSentence.attachmentID!==selection.attachmentID)append({label:'关联到已标记的起点语句',onCommand:async()=>{await E.linkSentences(E.pendingSentence,selection);E.pendingSentence=null;E.readerResultCard(reader,reader._iframeWindow.document,selection,'语句关联').status('已保存两篇文献的语句关联；可在侧栏“关联证据与论文图表”查看。');}});
 };Zotero.Reader.registerEventListener('createViewContextMenu',E.readerContextHandler,E.id);};
 E.readerResultCard=(reader,doc,selection,title)=>{
  doc.getElementById('easysch-reader-result')?.remove();
  const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  const card=el('section');card.id='easysch-reader-result';card.setAttribute('aria-label',title);
  card.style.cssText='position:fixed;right:18px;bottom:18px;z-index:10000;width:min(430px,calc(100vw - 36px));max-height:65vh;overflow:auto;box-sizing:border-box;padding:16px;border:1px solid var(--color-border,#bbb);border-radius:10px;background:var(--color-background,Canvas);color:var(--color-foreground,CanvasText);box-shadow:0 5px 24px #0003;font:menu;line-height:1.6;user-select:text;';
  card.style.top='60px';card.style.bottom='auto';card.style.fontSize='14px';card.tabIndex=-1;card.setAttribute('aria-live','polite');
  const bar=el('div');bar.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px';bar.append(el('strong',title));
  const button=(label,fn,parent=card)=>{const b=el('button',label);b.style.cssText='font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:5px;padding:4px 8px;cursor:pointer';b.onclick=fn;parent.append(b);return b;};
  button('关闭',()=>card.remove(),bar);card.append(bar);
  const original=el('details');original.append(el('summary',`原文选区 · PDF 第 ${(selection.pageIndex??0)+1} 页`),el('blockquote',selection.text));card.append(original);
  button('回到原文',()=>E.library.openSource(selection));
  const output=el('div','正在处理选中文字…');output.setAttribute('role','status');output.style.whiteSpace='normal';card.append(output);doc.body.append(card);
  return {
   show:()=>{if(!card.isConnected)doc.body.append(card);card.focus({preventScroll:true});},
   status:text=>output.textContent=text,
   error:(error,retry)=>{output.textContent='未完成：'+error.message;if(retry)button('重试这段文字',retry,output);},
   render:record=>{
    output.replaceChildren();
    const renderer=E.contentRenderer(doc);let bilingual=false;const sections=el('div');button('双语对照',()=>{bilingual=!bilingual;original.open=bilingual;original.style.display=bilingual?'block':'';},output);button('复制正文',()=>Zotero.Utilities.Internal.copyTextToClipboard(renderer.plainText(sections)),output);output.append(sections);
    for(const section of record.result.sections||[]){const body=el('div');E.renderContent(body,section.body,{sources:record.sources,onSource:s=>E.library.openSource(s)});sections.append(el('h3',section.heading),body);
     for(const id of section.sources||[]){const source=record.sources.find(s=>s.id===id);if(!source)continue;
      const details=el('details');details.append(el('summary',`证据 [${id}] · ${source.label}`),el('blockquote',source.text));button('定位这条证据',()=>E.library.openSource(source),details);output.append(details);
     }
    }
    if(record.result.keywords?.length)output.append(el('p','术语：'+record.result.keywords.join(' · ')));
    if(selection.position?.rects?.length){
     output.append(el('p','以上为 AI 笔记预览。确认保存后，将同时创建论文高亮和 Zotero 笔记。'));
     const save=button('确认保存笔记与高亮',async()=>{save.disabled=true;try{const saved=await E.saveReaderNote(selection,record);save.textContent='已保存笔记与高亮';button('撤销这次保存',async()=>{try{await saved.undo();save.textContent='已撤销';}catch(e){output.append(el('p',e.message));}},output);}catch(e){save.disabled=false;output.append(el('p',e.message));}},output);save.id='research-save-annotation-note';
    }
    output.append(el('small','AI 解释与翻译 · 请结合原文核对。选区消失后此结果仍会保留。'));
   }
  };
 };
})(Zotero.Research);
