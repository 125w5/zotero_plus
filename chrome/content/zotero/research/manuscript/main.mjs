import {installPromptTemplates} from '../shared/prompt-templates.mjs';
import {installModePicker,resolveMode,materialPreview} from '../shared/material-browser.mjs';
/* SPDX-License-Identifier: AGPL-3.0-or-later */
import * as M from '../shared/manuscript-model.mjs';
import {renderEditor,insertBlock,renderDetails} from './editor.mjs';
import {installKeyboard,outlineBlock} from './keyboard.mjs';
import {themeLibrary,installManualWritingToolbar} from './writing-tools.mjs';
import {installWritingRibbon} from './writing-ribbon.mjs';
import {installAssembly,findEvidence,organizeLayout,showLayoutProposal} from './assembly-tools.mjs';
import {renderMaterialLibrary} from './material-library.mjs';
import {installEditorInteractions} from './editor-interactions.mjs';
import {tablePicker} from './table.mjs';
import {renderMaterialClues} from './material-clues.mjs';
import {materialAnchors} from '../shared/material-clues.mjs';
import {installAssemblyAIOrb} from './assembly-orb.mjs';
import {installAssemblyConversation} from './assembly-conversation.mjs';
import {installAssemblyWorkflow} from './assembly-workflow.mjs';
import {isCurrentAssessment} from '../shared/manuscript-assessment.mjs';
import {renderAssemblyNavigation} from './assembly-navigation.mjs';
import {installAssemblyChatContext} from './assembly-chat-context.mjs';
import {assemblyTaskRequest} from './assembly-task-context.mjs';
import {installAssemblyComposer} from './assembly-composer.mjs';
import {installAssemblyConversationFiles} from './assembly-conversation-files.mjs';
import {referencedAssetsChanged,rememberAssetViewDefaults,assetViewProjectSnapshot} from './assembly-asset-view.mjs';
import {renderMaterialExplanationEditor} from './material-content-editor.mjs';
import {renderMaterialOverview} from './material-overview.mjs';
import {installMediaPreview,disposeMediaPreviews} from '../shared/media-preview.mjs';
import {createCoalescedSave} from '../shared/coalesced-save.mjs';
import {installAssemblyPages} from './assembly-pages.mjs';
import {syncFrameworkStatuses} from '../shared/writing-framework.mjs';
import {updateWritingDigestStates} from './assembly-framework.mjs';
export const $=id=>document.getElementById(id);
export const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export const U={E:window.parent.Zotero.Research,M,$,el,ready:false,p:null,selectedCells:[],undo:[],redo:[],saving:Promise.resolve(),busy:false};
export function status(text,error=false){const notice=$('status');clearTimeout(U.statusTimer);notice.textContent=text||'';notice.hidden=!text;notice.classList.toggle('error',error);$('ai-notice').hidden=true;notice.title=error?'单击关闭提示':'';notice.onclick=()=>{notice.hidden=true;};if(text&&!error)U.statusTimer=setTimeout(()=>{notice.hidden=true;},4000);}
export function button(text,fn,host,cls){const b=el('button',text,cls);b.type='button';b.onclick=async e=>{try{await fn(e);}catch(err){status(err.message,true);}};host?.append(b);return b;}
export function field(host,label,value,fn,type='input'){const l=el('label',label),input=el(type);input.value=value??'';input.onchange=()=>{try{fn(input.value);}catch(e){status(e.message,true);}};l.append(input);host.append(l);return input;}
export function modal(title){const box=$('popover-content');box.replaceChildren(el('h2',title));$('popover').showModal();return box;}
export function snapshot(){U.undo.push(M.clone(U.p));U.undo=U.undo.slice(-30);U.redo=[];}
export function changed({editor=false}={}){persist();renderNavigation();if(editor)renderEditor();renderDetails();}
let saveQueue,catalogSignature;
const assetViewDefaults=new Map();
export function projectSnapshot(){return assetViewProjectSnapshot(U.p,assetViewDefaults,M.clone);}
export function persist(options={}){
 syncFrameworkStatuses(U.p);updateWritingDigestStates(U);
 if(!saveQueue){saveQueue=createCoalescedSave({read:()=>{if(U.closing)return null;const value=projectSnapshot();value.revision=U.savedRevision;return value;},write:async value=>{const saved=await U.A.save(value);U.savedRevision=saved.revision;U.p.revision=saved.revision;const signature=JSON.stringify([value.id,value.title,value.materialPaperIDs,value.materials,value.materialCatalog]);if(signature!==catalogSignature){catalogSignature=signature;U.E.notebook?.catalogChanged(value.id);}},onState:(state,error)=>{const text=state==='saved'?'已保存到本机':state==='error'?'保存失败':'保存中…',node=$('save-status');if(node.textContent!==text)node.textContent=text;if(state==='saved')U.saveError=null;if(error){U.saveError=error;status(error.message,true);}}});window.addEventListener('pagehide',()=>saveQueue?.dispose(),{once:true});}
 U.saving=saveQueue.request(options).catch(()=>{});return U.saving;
}
export function selectBlock(id,{scroll=false,preserveSelection=false}={}){
 if(id){
  const clear=U.previewMaterialID||U.E.notebook.state(U.p.id).selectedMaterial;
  U.previewMaterialID=null;U.p.ui.materialID=null;
  if(clear||U.pendingMaterialSelection)syncMaterialSelection(null);
 }
 if(!preserveSelection)U.p.ui.selectedBlocks=id?[id]:[];
 if(U.textSelection?.blockID!==id)U.textSelection=null;U.p.ui.blockID=id;
 const b=U.p.blocks.find(x=>x.id===id);if(b)U.p.ui.sectionID=b.sectionID;
 for(const n of document.querySelectorAll('.block'))n.classList.toggle('selected',n.dataset.id===id);for(const n of document.querySelectorAll('[data-outline-block]'))n.classList.toggle('selected',U.p.ui.selectedBlocks.includes(n.dataset.outlineBlock));
 renderDetails();U.workflow?.render();renderChat();persist();
 if(scroll)document.querySelector('[data-id="'+id+'"]')?.scrollIntoView({block:'center'});
}
export function selected(){return U.p.blocks.find(b=>b.id===U.p.ui.blockID);}
function openCoauthor(){delete $('ai').dataset.unfocused;if(U.assemblyCLUI?.mode==='compact'&&(U.conversationSession?.messages?.length||U.aiSending||U.chatInteractionHeight))U.assemblyCLUI.setConversation();if(!U.p.ui.aiOpen){U.p.ui.aiOpen=true;applyPanels();persist();}renderChat();}
function expandCoauthor(){
 if(U.collapsingAI)return;
 if(U.assemblyCLUI){if(U.assemblyCLUI.mode==='compact')U.assemblyCLUI.setConversation();return;}
 const changed=!U.chatExpanded;U.chatExpanded=true;
 if(!U.p.ui.aiOpen)openCoauthor();else{delete $('ai').dataset.unfocused;if(changed)applyPanels();}
}
function closeCoauthor(){U.assemblyCLUI?.setExpanded(false);U.p.ui.aiOpen=false;U.chatExpanded=false;U.chatReadingHeight=0;U.chatReadingSessionID='';U.composerHeight=0;U.conversationSurface?.hideOptions?.();const form=$('ai-form');for(const popup of form.querySelectorAll('.prompt-templates,[data-composer-popup]'))popup.hidden=true;applyPanels();if($('ai').contains(document.activeElement)){U.collapsingAI=true;try{$('ai-prompt').focus({preventScroll:true});}finally{U.collapsingAI=false;}for(const popup of form.querySelectorAll('.prompt-templates,[data-composer-popup]'))popup.hidden=true;}persist();}
function installCoauthorGrowth(){
 const ai=$('ai'),form=$('ai-form'),input=$('ai-prompt');let pointerStart;
 // Blank shell space opens the history once. Source controls, selectable
 // answers and drag handles retain their own interaction and pointer events.
 const start=event=>{pointerStart={x:event.clientX,y:event.clientY};};
 const click=event=>{
  const began=pointerStart;pointerStart=null;
  if(U.assemblyCLUI){
   if(event.target===input){expandCoauthor();event.stopPropagation();return;}
   const selection=window.getSelection(),moved=event.detail>0&&began&&Math.hypot(event.clientX-began.x,event.clientY-began.y)>4;
   if(moved||selection&&!selection.isCollapsed||event.target.closest('a,button,input,textarea,select,summary,details,.message-meta,img,table,.katex-display,[data-dragging=true]')){event.stopPropagation();return;}
   return;
  }
  if(event.button!==0||event.defaultPrevented||ai.dataset.resizing==='true')return;
  if(event.target===input){expandCoauthor();return;}
  if(event.detail>0&&began&&Math.hypot(event.clientX-began.x,event.clientY-began.y)>4)return;
  const selection=window.getSelection();if(selection&&!selection.isCollapsed)return;
  const message=event.target.closest('.coauthor-message');
  if(message){
   if(event.target.closest('a,button,input,textarea,select,summary,details,.message-meta,img,table,.katex-display,[data-dragging=true]'))return;
   if(U.chatReadingHeight)return;
   const ordinary=ai.getBoundingClientRect().height,available=Math.max(112,Math.min(640,innerHeight*.65,innerHeight-220));
   U.chatExpanded=true;U.chatReadingSessionID=U.conversationSession?.id||'';U.chatReadingHeight=Math.min(available,Math.max(ordinary+140,Math.min(480,available)));
   delete ai.dataset.unfocused;applyPanels();return;
  }
  if(event.target===form||event.target.matches('.ai-center-master,.ai-transcript-frame,#ai-history,#chat,#diff,.assembly-taskbar,.assembly-task-tabs,.assembly-task-actions,.ai-compose-actions'))expandCoauthor();
 };
 for(const host of [ai,form]){host.addEventListener('pointerdown',start);host.addEventListener('click',click);}
 window.addEventListener('pagehide',()=>{for(const host of [ai,form]){host.removeEventListener('pointerdown',start);host.removeEventListener('click',click);}},{once:true});
}
function installComposerTasks(){
 const input=$('ai-prompt'),toggle=$('ai-template-toggle'),mode=$('ai-mode'),panel=$('ai-form').querySelector('.prompt-templates');if(!panel)return;
 panel.id='assembly-prompt-templates';toggle.setAttribute('aria-controls',panel.id);
 const sync=()=>{toggle.setAttribute('aria-expanded',String(!panel.hidden));toggle.replaceChildren(el('span',({search:'检索',organize:'整理',evaluate:'评估',source:'问答'})[mode.value]||'自动','compose-mode-label'),el('span','⌄','compose-chevron'));};
 U.syncComposerMode=sync;
 toggle.onpointerdown=e=>e.preventDefault();toggle.onclick=()=>{const open=panel.hidden;if(open)input.focus({preventScroll:true});panel.hidden=!open;sync();};mode.addEventListener('change',sync);
 U.composerTemplateObserver=new MutationObserver(sync);U.composerTemplateObserver.observe(panel,{attributes:true,attributeFilter:['hidden']});sync();
}
function collectFooterControls(){
 const footer=document.querySelector('footer'),host=$('footer-actions');
 const collect=()=>{for(const control of footer.querySelectorAll(':scope > .paper-zoom,:scope > #writing-appearance'))host.append(control);};
 collect();U.footerControlObserver=new MutationObserver(collect);U.footerControlObserver.observe(footer,{childList:true});
}
export function applyPanels(){
 const s=U.p.ui,ai=$('ai'),form=$('ai-form');clearTimeout(U.chatCloseTimer);
 document.body.classList.toggle('research-chat-open',!!s.aiOpen);ai.classList.toggle('chat-open',!!s.aiOpen);ai.setAttribute('aria-hidden',String(!s.aiOpen));ai.inert=!s.aiOpen;
 if(s.aiOpen){if(ai.hidden){ai.hidden=false;ai.style.height='0px';void ai.offsetHeight;}}
 else{ai.style.height='0px';if(!ai.hidden)U.chatCloseTimer=setTimeout(()=>{if(!U.p.ui.aiOpen)ai.hidden=true;},window.matchMedia('(prefers-reduced-motion:reduce)').matches?0:220);}
 const hasHistory=(U.conversationSession?.messages||U.p.chat).length||$('diff').childElementCount;
 if(U.chatReadingSessionID&&U.chatReadingSessionID!==U.conversationSession?.id){U.chatReadingHeight=0;U.chatReadingSessionID='';}
 const maximumChatHeight=Math.max(112,Math.min(640,innerHeight*.65,innerHeight-220));
 const interactionHeight=Math.max(0,Number(U.chatInteractionHeight)||0),expanded=!!(U.assemblyCLUI?U.cluiMode!=='compact'||interactionHeight:hasHistory||U.chatExpanded||interactionHeight),ordinaryHeight=expanded?Math.min(Math.max(130,Number(s.aiHeight)||220),maximumChatHeight):112,reading=!!(s.aiOpen&&U.chatReadingHeight),chatHeight=s.aiOpen?Math.min(maximumChatHeight,Math.max(ordinaryHeight,reading?U.chatReadingHeight:0,interactionHeight)):0;
 ai.dataset.growth=reading?'reading':expanded?'expanded':'compact';
 if(s.aiOpen)ai.style.height=chatHeight+'px';
 form.style.setProperty('--composer-height',(s.aiOpen?Math.min(100,Math.max(44,U.composerHeight||44)):28)+'px');
 document.body.style.setProperty('--assembly-chat-height',chatHeight+'px');
 document.body.style.setProperty('--assembly-footer-height',document.querySelector('footer').getBoundingClientRect().height+'px');
 $('left').hidden=!s.leftOpen;$('right').hidden=!s.rightOpen;$('left').style.width=s.leftWidth+'px';$('right').style.width=s.rightWidth+'px';
 $('toggle-ai').replaceChildren();const logo=el('span',undefined,'easysch-symbol');logo.setAttribute('aria-hidden','true');$('toggle-ai').append(logo,el('span',s.aiOpen?'收起对话':'研究助手'));$('toggle-ai').title=s.aiOpen?'收起对话，保留输入栏':'展开研究助手';$('toggle-ai').setAttribute('aria-expanded',String(!!s.aiOpen));
 const main=$('workspace').querySelector('main').getBoundingClientRect();document.body.style.setProperty('--assembly-canvas-center',((main.left+main.right)/2)+'px');
 // The conversation occupies the article column. Its reference cards overlay
 // only the lower portions of the existing material and details columns.
 document.body.style.setProperty('--assembly-console-sessions',main.left+'px');document.body.style.setProperty('--assembly-console-evidence',Math.max(0,innerWidth-main.right)+'px');document.body.style.setProperty('--assembly-main-width',main.width+'px');
 document.body.dataset.chatLeftVisible=String(s.leftOpen);document.body.dataset.chatRightVisible=String(s.rightOpen);
 U.syncChatRails?.();U.aiOrb?.refresh();U.conversationSurface?.refresh();
}
export function renderNavigation(){
 $('project-title').textContent=U.p.title;U.workflow?.render();
 $('recommendation').replaceChildren();$('recommendation').hidden=true;
 $('left-tabs').replaceChildren();$('left-tabs').setAttribute('role','tablist');for(const [key,name]of [['materials','▧ 素材库'],['files','对话文件'],['structure','☷ 论文结构'],['evidence','◇ 来源核查']]){const tab=button(name,()=>{U.p.ui.left=key;U.workflow?.closePanel();renderNavigation();renderDetails();persist();},$('left-tabs'),U.p.ui.left===key?'active':'');tab.dataset.view=key;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(U.p.ui.left===key));}
 for(const b of $('left-tabs').children){b.setAttribute('role','tab');b.setAttribute('aria-selected',String(b.classList.contains('active')));}$('left-tabs').setAttribute('role','tablist');
 renderLibrary();
}
export function attachMaterial(b,id,role='primary'){b.hideMaterialFrame=false;let m=U.p.materials.find(m=>m.id===id);if(!m){const shared=U.A.assetLibrary()[id];if(!shared)return;m=M.clone(shared);U.p.materials.push(m);}if(!b.materials.some(x=>x.id===id))b.materials.push({id,role,revision:m.revision});if(!b.text.trim()&&['paragraph','placeholder'].includes(b.type)){if(m.imagePath){b.type='image';b.imagePath=m.imagePath;}else if(m.data?.rows?.length){b.type='table';M.bindTable(U.p,b,m);}}if(m.artifactID)b.artifactID=m.artifactID;b.review='missing';}
export function renderLibrary(){
 if(U.p.ui.left==='files'&&U.renderConversationFiles){U.renderConversationFiles();return;}
 if(U.p.ui.left==='materials'){renderMaterialLibrary();return;}
 renderAssemblyNavigation(U,{el,button,snapshot,changed,persist,selectBlock,attachMaterial,materialDetails,openMaterial,modal,field,verifyBlock});
}
function assetDetailSignature(m){return U.E.assets.key([m.id,m.revision,U.A.titleFor(m),U.A.summaryFor(m)]);}
function refreshAssetViews(){
 const assets=U.A.assetLibrary(),annotationChanges=!!U.A.applyMaterialAnnotationUpdates?.(U.p),sourcesChanged=referencedAssetsChanged(U.p,assets)||annotationChanges,priorEntries=new Set(Object.keys(U.p.materialCatalog?.entries||{}));
 if(sourcesChanged)U.A.syncAssets(U.p);
 renderLibrary();rememberAssetViewDefaults(U.p,priorEntries,assetViewDefaults);
 const m=assets[U.previewMaterialID],details=$('details');
 if(m&&U.p.ui.rightOpen&&details.dataset.materialId===m.id&&details.dataset.assetViewSignature!==assetDetailSignature(m))materialDetails(m);
 if(sourcesChanged){renderEditor();persist();}
}
export function insertMaterial(m){snapshot();const b=M.block('paragraph',U.p.ui.sectionID||U.p.sections[0].id);attachMaterial(b,m.id);const index=U.p.blocks.findIndex(x=>x.id===U.p.ui.blockID);U.p.blocks.splice(index<0?U.p.blocks.length:index+1,0,b);U.p.ui.blockID=b.id;changed({editor:true});status('已插入素材，来源关联保留 · Ctrl+Z 撤销');}
export function clearDetails(){U.disposeModuleDetails?.();U.disposeModuleDetails=null;U.formulaEditor?.flush?.();U.formulaEditor?.dispose();U.formulaEditor=null;U.imageSizeTools?.();U.imageSizeTools=null;U.materialExplanation?.dispose();U.materialExplanation=null;U.detailCanvasMedia?.();U.detailCanvasMedia=null;disposeMediaPreviews($('details'));U.disposeClues?.();U.disposeClues=null;const box=$('details');box.replaceChildren();delete box.dataset.materialId;return box;}
function syncMaterialSelection(id){
 if(U.pendingMaterialSelection?.id===id)return;
 if(!U.pendingMaterialSelection&&U.E.notebook.state(U.p.id).selectedMaterial===id)return;
 const intent={id};U.pendingMaterialSelection=intent;
 const task=id?U.E.notebook.select(U.p.id,id):U.E.notebook.update(U.p.id,{selectedMaterial:null});
 task.catch(e=>status(e.message,true)).finally(()=>{if(U.pendingMaterialSelection===intent)U.pendingMaterialSelection=null;});
}
export async function saveMaterialHighlights(m,highlights){
 const previousHighlights=U.M.clone(m.highlights||[]);
 if(m.assetID){const next=await U.A.editAsset(m.assetID,{highlights},m.revision);Object.assign(m,next);U.A.syncAssets(U.p);}
 else{snapshot();Object.assign(m,{highlights,userEdited:true,revision:m.revision+1});}
 await persist({flush:true});if(U.saveError)throw U.saveError;
 const synced=await U.A.syncMaterialHighlights?.(m,{previousHighlights});
 if(synced?.pending)status('批注已保存；原文位置尚待精确匹配。');
 if(U.previewMaterialID===m.id)materialDetails(m);
}
export function materialDetails(m){
 if(!m)return;if(U.previewMaterialID===m.id&&U.materialExplanation?.isDirty())return;U.A.ensureChineseSummaries?.([m]);const different=U.previewMaterialID!==m.id;U.previewMaterialID=m.id;U.p.ui.materialID=m.id;U.workflow?.closePanel();
 if(U.p.ui.catalog&&!U.p.ui.catalog.selection?.includes(m.id))U.p.ui.catalog.selection=[m.id];
 for(const card of $('library').querySelectorAll('[data-material]')){const active=U.p.ui.catalog?.selection?.includes(card.dataset.material)||false;card.classList.toggle('selected',active);card.setAttribute('aria-selected',String(active));}
 syncMaterialSelection(m.id);
 if(different)persist();if(!U.p.ui.rightOpen){U.p.ui.rightOpen=true;applyPanels();persist();}
 const box=clearDetails();box.dataset.materialId=m.id;box.dataset.assetViewSignature=assetDetailSignature(m);const heading=el('div',undefined,'detail-heading');heading.append(el('h3',U.A.titleFor(m)));
 const back=button('返回正文',()=>{U.previewMaterialID=null;U.p.ui.materialID=null;syncMaterialSelection(null);if(selected())selectBlock(selected().id);else{renderDetails();persist();}},heading,'quiet-action');back.dataset.action='return-module';box.append(heading);
 const actions=el('div',undefined,'detail-actions');button('插入正文',()=>{const b=selected();if(!b){insertMaterial(m);selectBlock(U.p.ui.blockID);return;}snapshot();attachMaterial(b,m.id);selectBlock(b.id);changed({editor:true});},actions,'primary').dataset.action='insert-material';
 if(materialAnchors(m).some(a=>a.attachmentID)||m.sourceItemID||m.anchor?.url)button('打开来源',()=>openMaterial(m),actions).dataset.action='open-source';box.append(actions);
 if(m.imagePath||m.data?.rows?.length||m.kind==='formula')materialPreview(box,m,U.E);
 const overview=renderMaterialOverview(box,m,{E:U.E,classification:U.p.materialCatalog?.entries[m.id]?.type,onOpenAnchor:(anchor,material)=>openMaterial(material,undefined,anchor),onSaveHighlights:highlights=>saveMaterialHighlights(m,highlights),onError:e=>status(e.message,true)});
 U.materialExplanation=renderMaterialExplanationEditor(overview.summaryHost,m,{E:U.E,onSave:async patch=>{let next;if(m.assetID){next=await U.A.editAsset(m.assetID,patch,m.revision);Object.assign(m,next);U.A.syncAssets(U.p);}else{snapshot();Object.assign(m,patch);m.userEdited=true;m.revision++;next=m;}M.invalidate(U.p,m.id);await persist();renderLibrary();return next;},onOpenAnchor:anchor=>openMaterial(m,undefined,anchor),onError:e=>status(e.message,true),onStatus:status});
 U.disposeClues=overview.dispose;
 const used=U.p.blocks.filter(b=>b.materials.some(x=>x.id===m.id));if(used.length){const group=el('section',undefined,'material-usage');group.append(el('h4','用于本稿'));for(const b of used)button((U.p.sections.find(s=>s.id===b.sectionID)?.title||'章节')+' · '+(b.title||b.text||'待填写').slice(0,36),()=>selectBlock(b.id,{scroll:true}),group,'material-usage-link');box.append(group);}
 const edit=el('details',undefined,'material-maintenance');edit.append(el('summary','编辑与更新'));button('重新整理中文说明',async()=>{await U.A.ensureChineseSummaries([m],{retry:true});if(U.previewMaterialID===m.id)materialDetails(m);renderLibrary();},edit);button('检查来源更新',()=>refreshMaterial(m),edit);box.append(edit);
 if(m.assetID){const title=field(edit,'标题',m.title,()=>{});button('保存标题',async()=>{const next=await U.A.editAsset(m.assetID,{title:title.value},m.revision);Object.assign(m,next);M.invalidate(U.p,m.id);changed();},edit);if(m.history?.length){const history=el('details');history.append(el('summary','历史版本'));for(const h of m.history)history.append(el('p',h.at+' · '+h.summary));edit.append(history);}}
}
export async function openMaterial(m,cell,explicitAnchor){
 if(!m)throw Error('素材来源暂不可用');if(m.kind==='idea'){status('这是 AI 构想，没有原文证据；请先设计实验验证。');return;}
 const anchor=explicitAnchor||materialAnchors(m).find(a=>a.attachmentID)||m.anchor||{};
 if(anchor.attachmentID){await U.E.library.openSource(anchor);return;}
 if(m.data){const box=modal(m.title),t=el('table');for(const [r,row]of m.data.rows.entries()){const tr=el('tr');for(const [c,value]of row.entries()){const td=el(r?'td':'th',value);if(cell?.row===r&&cell?.col===c)td.className='cell-selected';tr.append(td);}t.append(tr);}box.append(t);return;}
 if(m.imagePath){window.parent.Zotero.launchFile(m.imagePath);return;}if(m.sourceItemID){await U.A.openAnchor({...m,anchor});return;}if(anchor.url){window.parent.Zotero.launchURL(anchor.url);return;}
 if(m.kind==='abstract'){const box=modal(m.title+' · 仅依据摘要');box.append(el('p',m.fullSourceText||m.sourceText));return;}status('此素材尚无可打开的原文位置。');
}
export async function refreshMaterial(m){if(m.aiGenerated){await U.A.checkAssetSource(m);U.A.syncAssets(U.p);changed();if(m.verification==='stale')status('来源已变化；保留原摘录，请重新核验素材。');return;}const change=await U.A.refreshMaterial(m);if(change&&(change.sourceText!==m.sourceText||change.data?.hash&&change.data.hash!==m.data?.hash)){snapshot();if(m.assetID){Object.assign(m,await U.A.commitAssetSource(m,change));M.invalidate(U.p,m.id);}else M.updateMaterial(U.p,m.id,change);changed({editor:true});status('来源已变化。相关段落需要重新核验；正文未被覆盖。');}}
export function renderEvidence(host,b,sortable=false){const chain=el('div');if(sortable){chain.className='evidence-chain';const grip=el('div','↕ '+(b.title||b.text||'待填写模块').slice(0,40),'evidence-grip');grip.draggable=true;grip.title='上下拖动调整证据阅读顺序，不改变正文';grip.ondragstart=e=>e.dataTransfer.setData('application/x-manuscript-evidence',b.id);chain.append(grip,el('p','来源说明素材，素材支撑段落；章节结论仍需核验。','muted'));chain.ondragover=e=>e.preventDefault();chain.ondrop=e=>{e.preventDefault();const id=e.dataTransfer.getData('application/x-manuscript-evidence');if(!id||id===b.id)return;snapshot();const original=[...host.querySelectorAll('[data-evidence]')].map(x=>x.dataset.evidence),to=original.indexOf(b.id),ids=original.filter(x=>x!==id);ids.splice(to,0,id);U.p.ui.evidenceOrder=ids;changed();};}chain.dataset.evidence=b.id;for(const link of b.materials){const m=U.p.materials.find(x=>x.id===link.id);if(!m)continue;button(m.kind==='experiment'?'▦ 实验数据':m.anchor.attachmentID?`▤ PDF 原文 · 第 ${(m.anchor.pageIndex||0)+1} 页`:'▤ Zotero 笔记',()=>openMaterial(m),chain,'evidence-node '+b.review);chain.append(el('div','↓','arrow'));button(m.title,()=>materialDetails(m),chain,'evidence-node '+b.review);}chain.append(el('div','↓','arrow'));button((b.type==='table'?'▦ 表格：':'¶ 段落：')+(b.text||b.table?.caption||'待填写').slice(0,45),()=>selectBlock(b.id,{scroll:true}),chain,'evidence-node '+b.review);chain.append(el('div','↓','arrow'));const section=U.p.sections.find(s=>s.id===b.sectionID);button('章节结论 · '+(section?.conclusion||'尚未核验'),()=>{U.p.ui.sectionID=b.sectionID;const box=modal('章节结论');field(box,'结论（请核对本章节来源）',section.conclusion,v=>{section.conclusion=v;changed();},'textarea');},chain,'evidence-node '+(section?.conclusion?b.review:'missing'));host.append(chain);}
export async function pickMaterials(){
 const box=modal('选择素材');box.append(el('p','选择论文后勾选笔记与批注；所有来源保留在 Zotero。自己的实验可单独加入。'));
 const row=el('div',undefined,'row');box.append(row);
 button('导入 CSV / XLSX',async()=>{const f=await U.E.pick(window,'选择实验数据','file','csv;xlsx');if(!f)return;await importData(f);$('popover').close();},row);
 button('添加实验记录',()=>{const x=el('section');box.append(x);const name=field(x,'记录名称','我的实验',()=>{}),text=field(x,'实验设置、观察、失败原因或计划','',()=>{},'textarea');button('保存为实验素材',async()=>{if(!text.value.trim())throw Error('请先填写实验记录');snapshot();const saved=await U.A.publishMaterials([M.material({title:name.value,kind:'experiment',sourceText:text.value,anchor:{sourceText:text.value}})]);if(!U.p.materials.some(m=>m.id===saved.cards[0].id))U.p.materials.push(saved.cards[0]);changed();$('popover').close();},x);},row);
 const papers=await U.A.papers(),picker=el('details');picker.open=!(U.p.materialPaperIDs?.length);picker.append(el('summary','选择论文 · 可多选'));box.append(picker);
 const search=el('input');search.placeholder='按论文标题搜索';search.setAttribute('aria-label','搜索来源论文');picker.append(search);const paperList=el('div');paperList.style.maxHeight='180px';paperList.style.overflow='auto';picker.append(paperList);
 const cards=el('div');box.append(cards);let generation=0;U.p.materialPaperIDs||=[];
 const has=m=>U.p.materials.some(x=>m.sourceItemID?x.sourceItemID===m.sourceItemID:m.sourceRecordID?x.sourceRecordID===m.sourceRecordID:false);
 const load=async()=>{const token=++generation;const candidates=await U.A.candidates(U.p.materialPaperIDs);if(token!==generation)return;cards.replaceChildren();const experiments=el('details');experiments.append(el('summary','已有个人实验记录'));let count=0;
  for(const m of candidates){const label=el('label'),input=el('input');input.type='checkbox';input.dataset.sourceItem=m.sourceItemID||'';input.checked=has(m);label.append(input,document.createTextNode(m.title+' · '+m.sourceText.slice(0,85)));input.onchange=async()=>{try{input.disabled=true;if(input.checked&&!has(m)){const saved=await U.A.publishMaterials([m]);snapshot();if(!U.p.materials.some(m=>m.id===saved.cards[0].id))U.p.materials.push(saved.cards[0]);changed();}else if(!input.checked&&has(m)){const existing=U.p.materials.find(x=>m.sourceItemID?x.sourceItemID===m.sourceItemID:x.sourceRecordID===m.sourceRecordID);if(U.p.blocks.some(b=>b.materials.some(x=>x.id===existing.id))){input.checked=true;status('此素材已用于正文，请先解除模块关联。');}else{snapshot();U.p.materials=U.p.materials.filter(x=>x.id!==existing.id);changed();}}}catch(e){status(e.message,true);input.checked=has(m);}finally{input.disabled=false;}};if(m.kind==='experiment')experiments.append(label);else{cards.append(label);count++;}}
  if(!count)cards.append(el('p',U.p.materialPaperIDs.length?'选中论文暂无笔记或批注。可先阅读并标注，或加入自己的实验。':'请选择一篇或多篇论文，查看可用笔记与批注。','empty'));if(experiments.children.length>1)cards.append(experiments);
 };
 const renderPapers=()=>{paperList.replaceChildren();for(const paper of papers.filter(p=>p.title.toLowerCase().includes(search.value.toLowerCase()))){const label=el('label'),input=el('input');input.type='checkbox';input.dataset.paper=paper.id;input.checked=U.p.materialPaperIDs.includes(paper.id);label.append(input,document.createTextNode(paper.title));input.onchange=()=>{U.p.materialPaperIDs=U.p.materialPaperIDs.filter(id=>id!==paper.id);if(input.checked)U.p.materialPaperIDs.push(paper.id);persist();load().catch(e=>status(e.message,true));};paperList.append(label);}};search.oninput=renderPapers;renderPapers();await load();
 button('完成选择，开始装配',()=>{$('popover').close();return U.workflow.setStep(1);},box);
}
export async function importData(file){const data=await U.A.dataset(file);const m=M.material({title:data.sheet,kind:'experiment',file,sourceText:JSON.stringify(data.rows),data,anchor:{sourceText:JSON.stringify(data.rows)}});const saved=await U.A.publishMaterials([m]),existing=U.p.materials.find(m=>m.id===saved.cards[0].id);if(existing)return existing;snapshot();U.p.materials.push(saved.cards[0]);changed();return saved.cards[0];}
export async function verifyBlock(b){if(!b)throw Error('请选择需要核验的模块');const box=modal('逐条核对当前模块');box.append(el('p','已核验表示你已对照来源检查内容；AI 摘录匹配不等同于结论成立。'));renderEvidence(box,b);for(const e of b.evidence||[]){const m=U.p.materials.find(m=>m.id===e.materialID);button('核对摘录：'+e.quote,()=>openMaterial(m,e.cell),box);}button('来源支持当前内容，标记已核验',()=>{if(b.materials.some(x=>U.p.materials.find(m=>m.id===x.id)?.kind==='idea'))throw Error('构想素材尚未验证，不能标为已核验');if(b.claim&&!b.materials.length)throw Error('该论点还没有来源');for(const x of b.materials)x.revision=U.p.materials.find(m=>m.id===x.id)?.revision;b.review='verified';changed({editor:true});$('popover').close();},box);button('发现冲突',()=>{b.review='conflict';changed({editor:true});$('popover').close();},box);}
export async function check(){const issues=await U.A.check(U.p);const box=modal('导出前检查');box.append(el('p',issues.length?`${issues.length} 项内容需要处理`:'结构检查通过。请继续核对论证和版式。'));for(const issue of issues)button(issue.message,()=>{$('popover').close();selectBlock(issue.blockID,{scroll:true});},box);return issues;}
export async function exportDoc(preview){if(U.busy)throw Error('当前任务仍在执行');await persist({flush:true});if(U.saveError)throw U.saveError;const issues=await U.A.check(U.p);if(issues.length){await U.workflow.setStep(3);return;}if(!preview&&!isCurrentAssessment(U.p,U.A.assessment?.(U.p.id))){await U.workflow.setStep(3);status('先评估当前全文，再导出正文与执行方案。');return;}const folder=preview?null:await U.E.pick(window,'选择 Word 导出目录','folder');if(!preview&&!folder)return;U.busy=true;U.abort=new AbortController();status('正在生成 Word 文档并检查公式与表格…');$('cancel-ai').hidden=false;$('cancel-task').hidden=false;try{U.lastExport=await(preview?U.A.preview(U.p,status,U.abort.signal):U.A.exportBundle(U.p,folder,status,U.abort.signal));U.p.ui.lastExportPath=U.lastExport.path;if(U.lastExport.planPath)U.p.ui.lastPlanExportPath=U.lastExport.planPath;await persist();const mathWarnings=U.lastExport.mathWarnings||U.lastExport.structure?.mathWarnings||[];status((U.lastExport.planPath?'已导出论文正文与执行方案：'+U.lastExport.directory:'已导出 Word 文档：'+U.lastExport.path)+(mathWarnings.length?'；'+mathWarnings.length+' 处公式保留为可编辑 LaTeX 源码，请核对。':''));}finally{U.busy=false;$('cancel-ai').hidden=true;$('cancel-task').hidden=true;U.workflow.render();}}
async function aiSubmit(e){
 e.preventDefault();const input=$('ai-prompt'),submitted=input.value,submittedSession=U.conversationSession,submittedSessionID=submittedSession.id,{prompt,context}=assemblyTaskRequest(U.p,submitted);if(U.busy||U.aiSending)return;
 const mode=resolveMode($('ai-mode').value,prompt,'source');U.aiSending=true;U.activeResearchSessionID=submittedSessionID;U.updateAssemblyTaskState?.('running',submittedSessionID);openCoauthor();$('ask-ai').disabled=true;$('ai-mode').disabled=true;$('ai-notice').hidden=true;
 const clearSentDraft=()=>{if(input.value!==submitted||U.conversationSession.id!==submittedSessionID)return;input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));U.composerHeight=44;$('ai-form').style.setProperty('--composer-height',(U.p.ui.aiOpen?44:28)+'px');U.p.ui.aiDraft='';persist();};
 const report=(text,error=false)=>{status(text,error);if(U.aiActivity)U.aiActivity.textContent=text;};
 try{
  const templates=$('ai-form').querySelector('.prompt-templates');if(templates)templates.hidden=true;
  $('cancel-ai').hidden=false;
  U.aiActivity=el('div','正在查找相关来源…','coauthor-activity');U.aiActivity.setAttribute('role','status');$('chat').after(U.aiActivity);await persist();
  await U.sendResearchMessage(prompt,{sessionID:submittedSessionID,mode,assemblyContext:context,executionMode:submittedSession.executionMode||'auto',modelID:submittedSession.modelID,thinkingLevel:submittedSession.thinkingLevel,onProgress:report,fromComposer:true});renderChat();U.updateAssemblyTaskState?.('complete',submittedSessionID);
  clearSentDraft();await persist();
 }catch(err){U.updateAssemblyTaskState?.('error',submittedSessionID);status(err.message||'暂时未能完成，请重试。',true);}
 finally{U.aiSending=false;U.busy=false;if(U.activeResearchSessionID===submittedSessionID)U.activeResearchSessionID='';U.aiActivity?.remove();U.aiActivity=null;$('ask-ai').disabled=false;$('ai-mode').disabled=false;$('cancel-ai').hidden=true;}
}
export function renderChat(){
 $('ai-context').textContent='';U.updateChatContext?.();
 const messages=U.conversationSession?.messages||U.p.chat,sessionID=U.conversationSession?.id||'legacy:'+U.p.id,signature=JSON.stringify([sessionID,messages]);if(U.chatRendered===signature)return;
 const history=$('ai-history'),scrollTop=history.scrollTop,follow=U.chatRenderedSessionID!==sessionID||history.scrollHeight-scrollTop-history.clientHeight<=48;
 U.chatRendered=signature;U.chatRenderedSessionID=sessionID;if(U.chatScrollFrame)cancelAnimationFrame(U.chatScrollFrame);disposeMediaPreviews($('chat'));$('chat').replaceChildren();if(U.p.ui.aiOpen)applyPanels();
 for(const c of messages){const row=el('article',undefined,'coauthor-message '+(c.role==='user'?'from-user':'from-assistant')),body=el('div'),meta=el('div',undefined,'message-meta');if(c.role!=='user'){const symbol=el('span',undefined,'easysch-symbol');symbol.setAttribute('aria-hidden','true');meta.append(symbol);}meta.append(el('span',c.role==='user'?'你':'研究助手'));if(c.at){const date=new Date(c.at);if(!isNaN(date))meta.append(el('time',date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})));}row.append(meta,body);U.E.renderContent(body,c.text,{sources:c.sources||[],onSource:s=>U.openResearchCitation(s)});for(const media of body.querySelectorAll('img,.katex-display,table'))installMediaPreview(media,{alt:media.tagName==='IMG'?'回答图片':media.tagName==='TABLE'?'回答表格':'回答公式',...(media.tagName==='IMG'?{}:{content:()=>media.cloneNode(true)}),onError:e=>status(e.message,true)});if(c.role!=='user')button('保存笔记',()=>U.saveResearchMessage(c),meta,'quiet-action');$('chat').append(row);}
 history.scrollTop=follow?history.scrollHeight:scrollTop;
 U.chatScrollFrame=requestAnimationFrame(()=>{U.chatScrollFrame=null;if(U.chatRenderedSessionID===sessionID&&history.isConnected)history.scrollTop=follow?history.scrollHeight:scrollTop;});
}
export function showDiff(d,{reveal=true}={}){
 if(d.kind==='layout')return showLayoutProposal(d,{reveal});
 if(reveal){U.p.ui.aiOpen=true;applyPanels();}const box=$('diff');box.replaceChildren(el('h3','历史建议'));
 const content=el('div');U.E.renderContent(content,d.after||d.insertText||'');box.append(content,el('p','此建议来自旧版自动写作，现保留记录，不应用到正文。','muted'));
 button('收起记录',()=>box.replaceChildren(),box);
}
function renderAssessment(){
 const a=U.E.notebook.state(U.p.id).assessment;let box=$('assessment-inline');
 if(!a||!['ready','running','failed'].includes(a.status)){if(box)box.hidden=true;return;}
 if(!box){box=el('div');box.id='assessment-inline';$('steps').after(box);}box.hidden=false;box.replaceChildren();
 if(a.status==='ready')button('可行性方案',()=>{const v=U.E.notebook.state(U.p.id).versions.find(v=>v.id===a.versionID),host=modal('研究可行性与实验方案');if(v){const body=el('div');U.E.renderContent(body,U.E.notebook.planMarkdown(v),{sources:v.sources,onSource:s=>U.openResearchCitation(s)});host.append(body);}},box).title='查看已保存的可行性分析与实验方案';
 if(a.status==='running'){const cancel=button('评估中 · 停止',()=>U.E.notebook.cancelAssessment(U.p.id),box);cancel.title='正在评估研究可行性，可以继续写作';}
 if(a.status==='failed')button('重试评估',()=>U.E.notebook.startAssessment(U.p.id),box).title=a.message||'可行性评估未完成';
}
async function init(){U.A=U.E.manuscripts;const id=window.frameElement.manuscriptID;U.p=M.clone(U.A.get(id));if((U.p.ui.surfaceVersion||0)<2){if(!U.p.ui.leftWidth||U.p.ui.leftWidth<=310)U.p.ui.leftWidth=380;U.p.ui.surfaceVersion=2;}if((U.p.ui.surfaceVersion||0)<3){if(!U.p.ui.rightWidth||U.p.ui.rightWidth===320)U.p.ui.rightWidth=390;U.p.ui.surfaceVersion=3;}U.savedRevision=U.p.revision;window.ManuscriptUI=U;U.materialQuery=U.E.notebook.query(id)||'';U.unsubscribeNotebook=U.E.notebook.subscribe(projectID=>{if(projectID!==id)return;renderAssessment();const state=U.E.notebook.state(id);if(U.materialView!==state.materialView){U.materialView=state.materialView;renderLibrary();}if(U.materialQuery!==state.query){U.materialQuery=state.query||'';renderLibrary();}if(!U.pendingMaterialSelection&&!U.clearingMaterialSelection&&state.selectedMaterial&&U.previewMaterialID!==state.selectedMaterial){U.previewMaterialID=state.selectedMaterial;U.p.ui.materialID=state.selectedMaterial;if(U.p.ui.catalog&&!U.p.ui.catalog.selection?.includes(state.selectedMaterial))U.p.ui.catalog.selection=[state.selectedMaterial];renderLibrary();const m=U.A.assetLibrary()[state.selectedMaterial]||U.p.materials.find(m=>m.id===state.selectedMaterial);if(m)materialDetails(m);}else if(!U.pendingMaterialSelection&&!state.selectedMaterial&&U.previewMaterialID){U.previewMaterialID=null;U.p.ui.materialID=null;renderDetails();persist();}});Object.assign(U,{persist,projectSnapshot,importData,renderEditor,selectBlock,changed,insertBlock,renderLibrary,renderChat,exportDoc,insertMaterial,materialDetails,openMaterial,findEvidence,organizeLayout,showLayoutProposal,showDiff,openCoauthor,closeCoauthor,applyPanels});U.workflow=installAssemblyWorkflow(U,{el,button,persist,applyPanels,renderNavigation,selectBlock,verifyBlock,status,prepareWriting:()=>U.sendResearchMessage('请结合本章选择的素材和已写正文整理写作速读',{fromComposer:false}),insertFigure:type=>type==='table'?tablePicker():insertBlock(type),exportDocuments:()=>exportDoc(false),findEvidence});
 $('close-popover').onclick=()=>$('popover').close();$('toggle-left').onclick=()=>{U.p.ui.leftOpen=!U.p.ui.leftOpen;applyPanels();persist();};$('toggle-right').onclick=()=>{U.p.ui.rightOpen=!U.p.ui.rightOpen;applyPanels();persist();};$('collapse-chat').onclick=closeCoauthor;$('toggle-ai').onclick=()=>U.p.ui.aiOpen?closeCoauthor():openCoauthor();$('check').onclick=()=>U.workflow.setStep(3).catch(e=>status(e.message,true));$('preview').onclick=()=>exportDoc(true).catch(e=>status(e.message,true));$('export').onclick=()=>exportDoc(false).catch(e=>status(e.message,true));$('cancel-ai').onclick=$('cancel-task').onclick=()=>{U.abort?.abort();U.frameworkAbort?.abort();};document.querySelector('.ai-collapsed-name').onclick=()=>{openCoauthor();$('ai-prompt').focus();};$('ai-form').onsubmit=aiSubmit;$('ai-prompt').value=U.p.ui.aiDraft||'';$('ai-prompt').addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!U.composing&&e.keyCode!==229&&$('ai-form').querySelector('.prompt-templates')?.hidden){e.preventDefault();e.stopImmediatePropagation();closeCoauthor();return;}if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.isComposing&&!U.composing&&e.keyCode!==229){e.preventDefault();$('ai-form').requestSubmit();}});$('ai-prompt').addEventListener('input',()=>{U.composerHeight=Math.min(100,Math.max(44,$('ai-prompt').scrollHeight));if(U.p.ui.aiOpen)$('ai-form').style.setProperty('--composer-height',U.composerHeight+'px');U.p.ui.aiDraft=$('ai-prompt').value;persist();});$('ai-prompt').addEventListener('focus',expandCoauthor);$('ai-prompt').addEventListener('pointerdown',expandCoauthor);installCoauthorGrowth();installModePicker($('ai-mode'),$('ai-prompt'),{value:U.E.notebook.state(id).aiMode,onChange:aiMode=>{U.E.notebook.update(id,{aiMode});if(U.conversationSession)U.conversations.update(U.conversationSession.id,{mode:aiMode},{origin:'assembly'}).catch(e=>status(e.message,true));}});
 const writingTools=el('div');writingTools.id='manual-writing-tools';$('insert-tools').append(writingTools);U.manualWritingToolbar=installManualWritingToolbar(writingTools);
 const insertActions=el('div',undefined,'manuscript-insert-actions');insertActions.setAttribute('role','group');insertActions.setAttribute('aria-label','插入对象');$('insert-tools').append(insertActions);
 for(const [name,fn]of [['引用',()=>insertBlock('citation')],['公式',()=>insertBlock('formula')],['表格',tablePicker],['图片',()=>insertBlock('image')],['论文模块',()=>{const box=modal('选择论文模块');for(const [type,name]of [['paragraph','正文'],['heading','小标题'],['list','列表'],['placeholder','待填内容卡']])button(name,()=>{insertBlock(type);$('popover').close();},box);}]]){const control=button(name,fn,insertActions);control.title='插入'+name;control.setAttribute('aria-label','插入'+name);}
 installAssemblyPages(U,{snapshot,changed,persist,status});installWritingRibbon(U,{el,button,snapshot,changed,persist,status,selectBlock});
 let scrollTimer;$('canvas').onscroll=()=>{U.p.ui.scrollTop=$('canvas').scrollTop;clearTimeout(scrollTimer);scrollTimer=setTimeout(persist,180);};
 installKeyboard();installAssembly();installEditorInteractions();$('footer-actions').append($('paper-zoom'));const appearance=$('writing-appearance');if(appearance)$('footer-actions').append(appearance);collectFooterControls();installPromptTemplates(document,U.E,{openOnFocus:false,onSelect:input=>{if(input.id==='ai-prompt')queueMicrotask(()=>{const panel=$('ai-form').querySelector('.prompt-templates');if(panel)panel.hidden=true;});}});installComposerTasks();U.aiOrb=installAssemblyAIOrb(U,{open:()=>U.conversationSurface?.show({nearLogo:true}),close:()=>U.conversationSurface?.hide()});await installAssemblyConversation(U,{renderChat,applyPanels,persist,status});installAssemblyChatContext(U,{el,button,status,persist});$('ai-attach').onclick=()=>U.attachResearchFiles?.().catch(e=>status(e.message,true));$('ai-options').onclick=()=>U.conversationSurface?.showOptions?.('all',{anchor:$('ai-options')});
 installAssemblyComposer(U,{status,persist});
 U.conversationFileWorkspace=installAssemblyConversationFiles(U,{status,persist});
 for(const grip of document.querySelectorAll('[data-panel],.ai-grip'))grip.onpointerdown=e=>{const key=grip.dataset.panel||'aiHeight',start=key==='aiHeight'?e.clientY:e.clientX,value=key==='aiHeight'?$('ai').getBoundingClientRect().height:U.p.ui[key];grip.setPointerCapture(e.pointerId);grip.onpointermove=e=>{if(key==='aiHeight'){U.chatExpanded=true;U.chatReadingHeight=0;U.chatReadingSessionID='';}U.p.ui[key]=Math.max(key==='aiHeight'?130:190,Math.min(640,value+((key==='leftWidth'?1:-1)*((key==='aiHeight'?e.clientY:e.clientX)-start))));applyPanels();};grip.onpointerup=()=>{grip.onpointermove=null;persist();};};
 U.previewMaterialID=U.E.notebook.state(id).selectedMaterial||U.p.ui.materialID||null;applyPanels();renderNavigation();renderEditor();renderChat();renderAssessment();U.workflow.render();const pending=U.p.proposals.findLast(d=>d.kind==='layout'&&d.status==='pending');if(pending)showDiff(pending,{reveal:false});$('canvas').scrollTop=U.p.ui.scrollTop;status('');U.ready=true;if(['queued','running'].includes(U.E.notebook.state(id).assessment?.status))U.E.notebook.startAssessment(id).catch(e=>status(e.message,true));U.unsubscribeAssets=U.A.onAssetsChanged?.(refreshAssetViews);
 window.addEventListener('resize',applyPanels);window.addEventListener('pagehide',event=>{if(event.target!==document)return;window.removeEventListener('resize',applyPanels);clearTimeout(U.chatCloseTimer);U.composerTemplateObserver?.disconnect();U.footerControlObserver?.disconnect();U.aiOrb?.dispose();U.manualWritingToolbar?.destroy?.();U.materialExplanation?.dispose();disposeMediaPreviews($('chat'));U.disposeClues?.();U.unsubscribeAssets?.();U.unsubscribeNotebook?.();if(!U.closing)persist();});window.addEventListener('focus',async()=>{U.A.syncAssets(U.p);for(const m of U.p.materials.filter(m=>m.aiGenerated&&m.assetID)){try{await U.A.checkAssetSource(m);}catch(e){M.invalidate(U.p,m.id);status(e.message,true);}}U.A.syncAssets(U.p);for(const m of U.p.materials.filter(m=>!m.aiGenerated&&(m.file||m.sourceItemID))){try{await refreshMaterial(m);}catch(e){status(e.message,true);}}});
}
init().catch(e=>status('论文装配未能打开：'+e.message,true));
