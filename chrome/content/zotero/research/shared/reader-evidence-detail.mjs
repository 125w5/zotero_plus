/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {formulaSourceKey,normalizeFormulaInput} from './formula-research.mjs';
import {evidenceCaption} from './evidence-reading-context.mjs';
import {prepareReaderPaneStyles} from './reader-pane-styles.mjs';

const HTML='http://www.w3.org/1999/xhtml',SVG='http://www.w3.org/2000/svg',viewers=new WeakMap();
const ICONS={close:'m6 6 12 12M6 18 18 6',locate:'M12 3v4m0 10v4M3 12h4m10 0h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',note:'M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h5',explain:'M4 4h16v12H9l-5 4Z',copy:'M8 8h12v13H8ZM16 8V3H3v13h5'};

// List eligibility is a view rule, never a deletion of extracted equations.
export function visibleReaderEvidence(assets){return (assets||[]).filter(asset=>asset.kind==='figure'||asset.kind==='table');}
export function readerEvidenceLabel(asset){return String(asset.label||({figure:'图片',table:'表格',formula:'公式'}[asset.kind])||'原图').replace(/^Fig(?:ure)?\.?\s*/i,'图 ').replace(/^Tab(?:le)?\.?\s*/i,'表 ').replace(/^(?:Eq(?:uation)?|Formula)\.?\s*/i,'公式 ').replace(/^(图|表|公式)\s+(\d)/,'$1$2');}
export function appendEvidenceCaption(target,asset){
 const doc=target.ownerDocument,runs=Array.isArray(asset.captionRuns)?asset.captionRuns.filter(run=>typeof run?.text==='string'):[];
 target.replaceChildren();if(asset.kind==='formula')return;if(!runs.length){target.textContent=evidenceCaption(asset);return;}
 for(const run of runs){const tag=run.script==='super'?'sup':run.script==='sub'?'sub':run.fontStyle==='italic'?'em':'span',chunk=doc.createElementNS(HTML,tag);if(run.fontStyle==='italic'&&tag!=='em'){const italic=doc.createElementNS(HTML,'em');italic.textContent=run.text;chunk.append(italic);}else chunk.textContent=run.text;target.append(chunk);}
}

/** One media viewer for extracted figures/tables/equations, with the SAME
 * reader Logo conversation temporarily mounted into its bottom-right region.
 * Merely opening it never sends a model request or creates a saved session. */
export async function openReaderEvidenceDetail(E,reader,asset,{doc=reader?._window?.document,origin,imageSource=path=>E.previewImage(path)}={}){
 if(!doc)throw Error('请先在阅读器中打开这篇论文');
 await prepareReaderPaneStyles(doc,{Zotero:reader?._window?.Zotero||doc.defaultView.Zotero,name:'evidence',url:'chrome://zotero/content/research/shared/reader-evidence-detail.css'});
 const previous=viewers.get(doc);if(previous?.asset.id===asset.id){previous.root.focus({preventScroll:true});return previous;}previous?.close();
 const win=doc.defaultView,node=(tag,cls,parent,text)=>{const value=doc.createElementNS(HTML,tag);value.className=cls||'';if(text!==undefined)value.textContent=text;parent?.append(value);return value;};
 const root=node('div','reader-evidence-backdrop'),dialog=node('section','reader-evidence-detail',root);root.tabIndex=-1;root.dataset.assetId=String(asset.id);dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',readerEvidenceLabel(asset)+' · 来源与解读');
 const header=node('header','reader-evidence-header',dialog),title=node('h2','',header,readerEvidenceLabel(asset));title.id='evidence-detail-title';dialog.setAttribute('aria-labelledby',title.id);
 node('span','reader-evidence-page',header,Number.isInteger(asset.pageIndex)?'第 '+(asset.page||asset.pageIndex+1)+' 页':'');
 const actions=node('div','reader-evidence-actions',header),status=node('p','reader-evidence-status',dialog);status.hidden=true;status.setAttribute('role','status');
 const button=(name,label,fn,parent=actions)=>{const value=node('button','reader-evidence-button',parent);value.type='button';value.title=label;value.setAttribute('aria-label',label);const svg=doc.createElementNS(SVG,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=doc.createElementNS(SVG,'path');path.setAttribute('d',ICONS[name]||ICONS.close);svg.append(path);value.append(svg);value.onclick=fn;return value;};
 const imageRegion=node('div','reader-evidence-image-region',dialog),image=node('img','reader-evidence-original',imageRegion);image.alt=asset.caption||asset.label||'论文原图';image.draggable=false;image.title='双击定位原文';
 const right=node('aside','reader-evidence-sidebar',dialog),reading=node('div','reader-evidence-reading',right),source=node('section','reader-evidence-source',reading);
 const attachment=win.Zotero?.Items?.get(asset.attachmentID||reader.itemID),paperTitle=asset.paperTitle||(attachment?.parentItem||attachment)?.getField?.('title')||'当前论文';
 node('h3','reader-evidence-section-label',source,'来源');const paper=node('button','reader-evidence-paper',source,paperTitle);paper.type='button';paper.title='定位本文原图';
 const caption=node('p','reader-evidence-caption',source);appendEvidenceCaption(caption,asset);caption.hidden=!caption.textContent.trim();
 const explanation=node('section','reader-evidence-explanation',reading);explanation.setAttribute('aria-label','论文图表解释');
 const chatHost=node('div','reader-evidence-chat',right);chatHost.setAttribute('aria-label','当前论文的共享对话');
 let disposed=false,chatLease,offMaterials,offImages,formulaController,tabObserver,explanationKey='',originFocus=origin||doc.activeElement;
 const setStatus=(text,error=false)=>{if(disposed)return;status.textContent=text||'';status.hidden=!text;status.dataset.error=String(error);};
 const close=()=>{if(disposed)return;disposed=true;formulaController?.abort();offMaterials?.();offImages?.();if(tabObserver)win.Zotero?.Notifier?.unregisterObserver(tabObserver);doc.removeEventListener('keydown',escape);root.removeEventListener('easysch-conversation-close-request',close);win.removeEventListener('pagehide',pagehide);chatLease?.dispose();root.remove();if(viewers.get(doc)===control)viewers.delete(doc);if(originFocus?.isConnected&&(!reader.tabID||win.Zotero_Tabs?.selectedID===reader.tabID))originFocus.focus({preventScroll:true});};
 const locate=async()=>{try{await reader.navigate({pageIndex:asset.pageIndex,position:E.assets.position(asset)});close();}catch(error){setStatus('原文定位失败：'+error.message,true);}};
 paper.onclick=locate;image.ondblclick=event=>{event.preventDefault();locate();};
 const noteButton=button('note','保存完整原图与解读为笔记',async()=>{if(noteButton.disabled)return;noteButton.disabled=true;try{const saved=await E.saveAssetNote(asset,{reader});if(disposed)return;chatLease?.surface?.show();chatLease?.surface?.refresh();setStatus(saved.warning||'已保存为笔记');}catch(error){setStatus(error.message,true);}finally{noteButton.disabled=false;}});
 button('locate','定位原文',locate);button('close','关闭（Esc）',close);
 const renderText=(host,text,sources=[])=>{if(E.renderContent)E.renderContent(host,text,{sources,onSource:value=>E.library.openSource({...value,...value.anchor})});else host.textContent=text;};
 const validatedLatex=value=>{const latex=normalizeFormulaInput(value);if(!latex)return '';const probe=node('div');renderText(probe,'$$\n'+latex+'\n$$');if(!probe.querySelector('.katex')||probe.querySelector('.katex-error'))throw Error('公式格式尚未识别完整，请核对原式后重新识别');return latex;};
 const selectedModel=()=>{const session=E.workbenchConversations?.getForScope?.({paperID:asset.paperItemID||attachment?.parentID||attachment?.id});return {...E.settings(),...(session?.modelID?{model:session.modelID}:{}),...(session?.thinkingLevel?{thinkingLevel:session.thinkingLevel}:{})};};
 const renderExplanation=()=>{
  if(disposed)return;const material=E.assets.materialFor(asset),transcription=E.store?.get?.('formulaTranscriptions',formulaSourceKey(asset)),formula=E.store?.get?.('readerFormulaExplanations',formulaSourceKey(asset)),detail=material?.imageExplanation;
  const key=JSON.stringify([material?.revision,material?.summary,detail,material?.generationStatus,material?.generationError,formula,transcription?.latex]);if(key===explanationKey)return;explanationKey=key;explanation.replaceChildren();
  if(asset.kind==='formula'){
   let latex='';try{latex=validatedLatex(material?.data?.latex||material?.latex||transcription?.latex||'');}catch(error){node('p','reader-evidence-empty',explanation,error.message);}
   if(latex){const equation=node('div','reader-evidence-equation',explanation);renderText(equation,'$$\n'+latex+'\n$$');const copy=button('copy','复制 LaTeX',()=>{const clipboard=win.Zotero?.Utilities?.Internal?.copyTextToClipboard;if(clipboard)clipboard(latex);else Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(latex);setStatus('已复制 LaTeX');},equation);copy.classList.add('reader-evidence-copy');}
   if(formula?.text){const body=node('div','reader-evidence-richtext',explanation);renderText(body,formula.text,formula.sources||[]);}
   const explain=button('explain',formula?'重新解释公式':'解释公式',async()=>{
    if(formulaController)return;formulaController=new win.AbortController();explain.disabled=true;
    try{setStatus('正在读取原式…');const modelConfig=selectedModel(),value=latex?{latex}:await E.assets.recognizeFormula(asset,{signal:formulaController.signal,status:setStatus,validate:validatedLatex,modelConfig});
     if(disposed)return;const result=await E.assets.explainFormula({latex:value.latex,asset,sourceText:material?.sourceText===asset.caption?'':material?.sourceText||''},{signal:formulaController.signal,status:setStatus,modelConfig});
     if(disposed)return;await E.store.update(state=>{state.readerFormulaExplanations||={};state.readerFormulaExplanations[formulaSourceKey(asset)]=result;});setStatus('');renderExplanation();
    }catch(error){if(!disposed)setStatus(error.message,true);}finally{formulaController=null;explain.disabled=false;}
   },explanation);node('span','reader-evidence-action-label',explain,formula?'重新解释':'解释公式');
  }else{
   const summary=material?.summary?.trim();if(summary&&(material.userEdited||detail||['verified','confirmed'].includes(material.verification)||!['pending','running','failed'].includes(material.generationStatus))){const overview=node('div','reader-evidence-summary',explanation);renderText(overview,summary,detail?.sources||[]);}
   for(const section of detail?.result?.sections||[]){const group=node('section','reader-evidence-explanation-section',explanation);if(section.heading)node('h3','',group,section.heading);renderText(node('div','reader-evidence-richtext',group),section.body||'',detail.sources||[]);}
   if(!explanation.childElementCount){const text=material?.generationError?'图表说明暂未完成':'暂无已保存的图表解读';node('p','reader-evidence-empty',explanation,text);}
  }
 };
 const escape=event=>{if(event.key==='Escape'&&!event.isComposing&&!event.defaultPrevented){event.preventDefault();close();}};
 const pagehide=event=>{if(event.target===doc)close();};
 const control={root,dialog,image,asset,chatHost,close};viewers.set(doc,control);
 root.onclick=event=>{if(event.target===root)close();};root.onkeydown=event=>{if(event.key!=='Tab')return;const focusable=[...dialog.querySelectorAll('button,textarea,input,select,[tabindex="0"]')].filter(value=>!value.disabled&&!value.closest('[hidden]')&&value.getClientRects().length);if(!focusable.length)return;const at=focusable.indexOf(doc.activeElement);if(event.shiftKey&&at<=0){event.preventDefault();focusable.at(-1).focus();}else if(!event.shiftKey&&at===focusable.length-1){event.preventDefault();focusable[0].focus();}};
 doc.documentElement.append(root);doc.addEventListener('keydown',escape);root.addEventListener('easysch-conversation-close-request',close);win.addEventListener('pagehide',pagehide);renderExplanation();root.focus({preventScroll:true});
 offMaterials=E.manuscripts.onAssetsChanged?.(renderExplanation);offImages=E.assets.onImagesChanged?.(id=>{if(id===reader.itemID)renderExplanation();});
 if(reader.tabID&&win.Zotero?.Notifier)tabObserver=win.Zotero.Notifier.registerObserver({notify:()=>{if(win.Zotero_Tabs?.selectedID!==reader.tabID)close();}},['tab'],'reader-evidence-detail');
 Promise.resolve(imageSource(asset.path||asset.imagePath||asset.thumbnail)).then(value=>{if(!disposed)image.src=value;}).catch(error=>setStatus('原图读取失败：'+error.message,true));
 try{const lease=await E.mountReaderAcademicChat(reader,chatHost,{locked:true,focusAsset:asset});if(disposed)lease.dispose();else chatLease=lease;}catch(error){if(!disposed){chatHost.dataset.unavailable='true';node('p','reader-evidence-empty',chatHost,'对话暂未就绪');setStatus(error.message,true);}}
 return control;
}
