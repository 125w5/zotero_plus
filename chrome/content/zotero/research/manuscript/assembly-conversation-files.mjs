/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {normalizeChatAttachments} from '../shared/chat-attachments.mjs';
import {normalizeWritingWorkflow,updateWritingWorkflow} from '../shared/paper-writing-workflow.mjs';
import {installMediaPreview,disposeMediaPreviews} from '../shared/media-preview.mjs';
import {assemblyChatIcon} from './assembly-chat-context.mjs';
import {mountConversationFiles} from '../shared/conversation-files.mjs';
import {libraryView} from '../shared/material-access.mjs';

const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,'');
const kindLabel=kind=>({pdf:'论文',spreadsheet:'表格',image:'图片',docx:'文档',text:'文本',material:'素材'})[kind]||'文件';
export function assemblyFileMaterials(project,reference,sectionID=project.ui?.sectionID){
 const linked=new Set((project.blocks||[]).filter(row=>row.sectionID===sectionID).flatMap(row=>(row.materials||[]).map(link=>link.id)));
 return (project.materials||[]).filter(material=>linked.has(material.id)&&(reference.materialID?material.id===reference.materialID:
  reference.attachmentID&&(material.attachmentID===reference.attachmentID||material.anchor?.attachmentID===reference.attachmentID||[...(material.anchors||[]),...(material.sourceAnchors||[])].some(anchor=>anchor.attachmentID===reference.attachmentID))
  ||reference.paperItemID&&(material.paperItemID===reference.paperItemID||material.anchor?.paperItemID===reference.paperItemID)));
}
export function assemblyFileIsExemplar(project,reference,sectionID=project.ui?.sectionID){
 const ids=new Set(normalizeWritingWorkflow(project.writingWorkflow).sections[sectionID]?.referenceMaterialIDs||[]);
 return assemblyFileMaterials(project,reference,sectionID).some(row=>ids.has(row.id));
}
export function setAssemblyFileExemplar(project,reference,checked,{sectionID=project.ui?.sectionID}={}){
 const materials=assemblyFileMaterials(project,reference,sectionID);if(!materials.length)throw Error('请先为本章关联这篇论文的完整素材，再选择结构范文');
 const ids=new Set(normalizeWritingWorkflow(project.writingWorkflow).sections[sectionID]?.referenceMaterialIDs||[]);
 for(const material of materials)checked?ids.add(material.id):ids.delete(material.id);
 updateWritingWorkflow(project,{referenceMaterialIDs:[...ids]},{sectionID});
 // Respect an explicit chapter source list. Adding a structural example is an
 // explicit selection, but never changes its role into experimental evidence.
 if(checked&&Array.isArray(project.ui?.frameworkSources?.[sectionID]))project.ui.frameworkSources[sectionID]=[...new Set([...project.ui.frameworkSources[sectionID],...materials.map(row=>row.id)])];
 return materials.map(row=>row.id);
}
export function assemblyConversationFiles(project,references,{query='',filter='all',sectionID=project.ui?.sectionID}={}){
 const terms=normalize(query);return normalizeChatAttachments(references).filter(row=>(!terms||normalize([row.title,row.filename,kindLabel(row.kind),row.sheet].join(' ')).includes(terms))
  &&(filter==='selected'?row.selected:filter==='featured'?row.featured:filter==='exemplar'?assemblyFileIsExemplar(project,row,sectionID):true));
}

/** A source workspace beside the canvas. Files stay scoped to the selected
 * conversation; the right panel never creates a reader or navigates the PDF. */
export function installAssemblyConversationFiles(U,{persist,status}){
 const doc=U.$('library').ownerDocument,win=doc.defaultView,S=U.conversations,A=U.E.chatAttachments;let signature='',detailSignature='',detail,controller,generation=0,activeID='',activeSession='',fileRail,folderLabel='';
 if(!doc.getElementById('assembly-conversation-file-styles')){const link=doc.createElement('link');link.id='assembly-conversation-file-styles';link.rel='stylesheet';link.href=new URL('./assembly-conversation-files.css',import.meta.url).href;doc.head.append(link);}
 const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 const run=action=>Promise.resolve().then(action).catch(error=>status(error.message,true));
 const button=(label,action,parent,{icon,cls='assembly-file-control'}={})=>{const node=el('button',undefined,cls);node.type='button';node.title=label;node.setAttribute('aria-label',label);if(icon)node.append(assemblyChatIcon(doc,icon));node.append(el('span',label));node.onclick=()=>run(action);parent?.append(node);return node;};
 const refs=()=>A?.get?.(U.conversationSession.id)||U.conversationSession.attachments||[];
 const close=()=>{generation++;controller?.abort();if(detail)disposeMediaPreviews(detail);detail?.remove();detail=null;activeID=activeSession=detailSignature='';};
 // Selection and starring affect the answering scope, not a file's content.
 // Unrelated dialogue updates must not reread an open workbook or PDF preview.
 const detailKey=reference=>JSON.stringify([U.p.ui.sectionID,Object.fromEntries(Object.entries(reference).filter(([key])=>!['selected','featured','stateVersion'].includes(key)))]);
 const current=(owner,request)=>detail?.isConnected&&owner===U.conversationSession.id&&request===generation&&!controller?.signal.aborted;
 const selectedSection=()=>U.p.sections.find(row=>row.id===U.p.ui.sectionID);
 const render=()=>{
  if(U.p.ui.left!=='files')return;const host=U.$('library');
  if(!fileRail){
   host.replaceChildren();
   fileRail=mountConversationFiles({host,E:U.E,getSessionID:()=>U.conversationSession.id,
    getSessions:()=>[...new Map([...(U.conversationSessions||[]),U.conversationSession].map(row=>[row.id,row])).values()].filter(row=>row.projectID===U.p.id&&(!row.isDraft||row.id===U.conversationSession.id)),
    getFiles:()=>refs(),getContext:()=>({project:U.p.title,folder:folderLabel}),getRevision:()=>[U.p.ui.sectionID,U.p.writingWorkflow?.sections?.[U.p.ui.sectionID]?.referenceMaterialIDs],
    onNew:()=>S.create({title:'新研究对话',origin:'assembly',projectID:U.p.id}),
    onSession:id=>S.select(id,{scope:{projectID:U.p.id},summary:true}),onPreview:reference=>openDetail(reference),
    onFileDrag:(event,reference,owner)=>{if(U.dragResearchAttachment)U.dragResearchAttachment(event,reference);else A.setDragData(event,reference,owner);},
    onChange:()=>update(),onError:error=>status(error.message,true),title:'装配资料',
    fileFilters:[['all','全部'],['selected','已选'],['featured','精选'],['papers','论文'],['tables','表格'],['exemplar','结构范文']],
    matchesFile:(file,query,filter)=>filter==='papers'?file.kind==='pdf'&&assemblyConversationFiles(U.p,[file],{query}).length>0:filter==='tables'?file.kind==='spreadsheet'&&assemblyConversationFiles(U.p,[file],{query}).length>0:assemblyConversationFiles(U.p,[file],{query,filter}).length>0
   });
   fileRail.root.classList.add('assembly-conversation-files');
   const tools=fileRail.root.querySelector('.conversation-files-subheading');button('选择论文',()=>U.openAssemblySources?.('papers'),tools,{icon:'plus'});
   const hint=el('small',undefined,'assembly-files-scope');hint.dataset.sectionScope='true';fileRail.root.append(hint);
  }
  if(fileRail.root.parentElement!==host){host.replaceChildren(fileRail.root);}
  const hint=fileRail.root.querySelector('[data-section-scope]');if(hint)hint.textContent=(selectedSection()?.title||'当前章节')+' · 范文用于结构与表达参考';
  fileRail.render();
 };
 Promise.resolve(U.E.discoveryCollections?.()).then(result=>{folderLabel=(result?.collections||[]).find(row=>String(row.id)===String(U.p.paperCollectionID))?.path||'';fileRail?.render();}).catch(()=>{});
 const relatedMaterials=reference=>[...new Map([...U.p.materials,...Object.values(libraryView(U.A))].map(row=>[row.id,row])).values()].filter(row=>row.id===reference.materialID||reference.attachmentID&&(row.attachmentID===reference.attachmentID||row.anchor?.attachmentID===reference.attachmentID)||reference.paperItemID&&(row.paperItemID===reference.paperItemID||row.anchor?.paperItemID===reference.paperItemID));
 const metadata=async reference=>{const Zotero=U.E.window?.Zotero||win.parent?.Zotero,id=reference.paperItemID||reference.attachmentID;if(!id||!Zotero?.Items?.getAsync)return reference;let item=await Zotero.Items.getAsync(id);if(!item||item.deleted)return reference;if(item.isAttachment?.()&&item.parentID)item=await Zotero.Items.getAsync(item.parentID);await item?.loadDataType?.('itemData');return {...reference,...(item?{...U.E.library.describe(item),abstract:item.getField('abstractNote')}: {})};};
 const openDetail=async(reference,{view:initialView='info'}={})=>{
  close();const owner=U.conversationSession.id,request=++generation;controller=new win.AbortController();activeID=reference.id;activeSession=owner;detailSignature=detailKey(reference);U.p.ui.rightOpen=true;U.workflow?.closePanel();U.applyPanels();
  detail=el('section',undefined,'assembly-conversation-file-detail');detail.dataset.fileId=reference.id;detail.setAttribute('aria-label','对话文件详情');U.$('right').append(detail);const heading=el('header',undefined,'assembly-file-detail-heading');button('返回模块详情',close,heading,{icon:'chevron'});heading.append(el('strong',reference.title||'研究文件'));detail.append(heading);
  const tabs=el('nav',undefined,'assembly-file-detail-tabs');tabs.setAttribute('aria-label','文件详情');detail.append(tabs);const body=el('div',undefined,'assembly-file-detail-body');body.append(el('p','正在读取已保存资料…','assembly-files-empty'));detail.append(body);
  const sectionID=U.p.ui.sectionID,materials=relatedMaterials(reference),linked=assemblyFileMaterials(U.p,reference,sectionID),plan=el('div',undefined,'assembly-file-example');detail.append(plan);const example=el('input');example.type='checkbox';example.checked=assemblyFileIsExemplar(U.p,reference,sectionID);example.disabled=!linked.length;const label=el('label');label.append(example,el('span','用作“'+(selectedSection()?.title||'本章')+'”结构范文'));plan.append(label);plan.append(el('small',linked.length?'仅学习论证顺序与表达，不沿用范文结果。':'先在本章关联这篇论文的完整素材。'));example.onchange=()=>run(async()=>{if(owner!==U.conversationSession.id)return;setAssemblyFileExemplar(U.p,reference,example.checked,{sectionID});await persist({flush:true});render();});
  let info=reference,preview,view=initialView;detail.dataset.view=view;const paint=()=>{if(!current(owner,request))return;disposeMediaPreviews(body);body.replaceChildren();
   if(view==='info'){
    body.append(el('h3',info.paperTitle||info.title||reference.title));const meta=el('p',[info.authors,info.journal,info.year||info.date,kindLabel(reference.kind)].filter(Boolean).join(' · '),'assembly-file-meta');body.append(meta);if(info.doi||info.DOI)body.append(el('small','DOI '+(info.doi||info.DOI)));
    const abstract=info.abstract||info.abstractNote||materials.find(row=>row.summary)?.summary;if(abstract){const section=el('section',undefined,'assembly-file-content');section.append(el('h4','摘要与说明'));const text=el('div');U.E.renderContent(text,String(abstract));section.append(text);body.append(section);}
    if(reference.kind==='spreadsheet'&&preview?.workbook){renderWorkbook(body,preview.workbook,reference,owner);return;}
    const rows=preview?.rows||[];if(rows.length){const section=el('section',undefined,'assembly-file-content');section.append(el('h4',abstract?'内容摘录':'已读取内容'));const text=el('div');U.E.renderContent(text,String(rows[0].text||rows[0].sourceText||'').slice(0,2200));section.append(text);body.append(section);}else if(!abstract)body.append(el('p','暂无可展示的摘要；可在“线索”中查看已保存素材。','assembly-files-empty'));
   }else if(view==='images'){
    const images=materials.filter(row=>row.imagePath);if((reference.previewURL||reference.thumbnailURL)&&!images.some(row=>row.id===reference.materialID||row.imagePath===reference.previewURL||row.imagePath===reference.thumbnailURL))images.unshift({id:reference.id,title:reference.title,imagePath:reference.previewURL||reference.thumbnailURL});
    if(!images.length)body.append(el('p','此文件尚未保存图片证据。','assembly-files-empty'));
    for(const material of images.slice(0,40)){const figure=el('figure'),image=el('img');image.alt=material.title||'图片证据';figure.append(image);const path=material.imagePath;Promise.resolve(/^(?:data:|file:)/u.test(path)?path:U.E.previewImage(path)).then(src=>{if(current(owner,request)&&image.isConnected)image.src=src;}).catch(error=>status(error.message,true));installMediaPreview(image,{alt:image.alt,onError:error=>status(error.message,true)});figure.append(el('figcaption',material.summary||material.title||'图片证据'));body.append(figure);}
   }else{
    if(!materials.length&&!(preview?.rows||[]).length)body.append(el('p','暂无已保存线索。','assembly-files-empty'));
    for(const material of materials){const row=el('article',undefined,'assembly-file-clue');row.append(el('strong',material.title||'完整素材'),el('p',material.summary||material.sourceText||''));if(material.highlights?.length)row.append(el('small',material.highlights.length+' 处原文标注'));button('查看素材说明',()=>{close();U.materialDetails(material);},row);body.append(row);}
    if(!materials.length)for(const row of preview?.rows||[]){const article=el('article',undefined,'assembly-file-clue');article.append(el('strong',row.title||row.label||'来源摘录'),el('p',String(row.text||row.sourceText||'').slice(0,1400)));body.append(article);}
   }
   for(const warning of preview?.warnings||[])body.append(el('p',warning,'assembly-file-warning'));
  };
  for(const [key,label]of [['info','信息'],['images','图片'],['clues','线索']]){const tab=button(label,()=>{view=key;detail.dataset.view=view;for(const node of tabs.children)node.setAttribute('aria-selected',String(node===tab));paint();},tabs);tab.setAttribute('aria-selected',String(key===view));}
  try{const values=await Promise.allSettled([metadata(reference),A.preview(owner,reference.id,{signal:controller.signal})]);if(!current(owner,request))return;if(values[0].status==='fulfilled')info=values[0].value;if(values[1].status==='fulfilled')preview=values[1].value;paint();if(values[1].status==='rejected'){body.append(el('p',values[1].reason.message,'assembly-file-warning'));button('重新读取',()=>openDetail(refs().find(row=>row.id===reference.id)||reference),body);}}
  catch(error){if(current(owner,request))status(error.message,true);}
 };
 const renderWorkbook=(body,workbook,reference,owner)=>{
  const controls=el('div',undefined,'assembly-file-workbook-controls'),sheets=el('select');sheets.setAttribute('aria-label','选择工作表');for(const sheet of workbook.sheets||[]){const option=el('option',sheet.name+(sheet.hidden?'（隐藏）':''));option.value=sheet.name;option.selected=sheet.name===workbook.selectedSheet;sheets.append(option);}controls.append(sheets);const ranges=el('input');ranges.value=(reference.ranges||[]).join(', ');ranges.placeholder='全部已读取范围，或 A1:F50';ranges.setAttribute('aria-label','本次讨论的单元格范围');controls.append(ranges);body.append(controls);
  const apply=async()=>{if(owner!==U.conversationSession.id)return;await A.setState(owner,reference.id,{sheet:sheets.value,ranges:ranges.value.split(/[,，;]/u).map(value=>value.trim()).filter(Boolean)});};sheets.onchange=()=>run(apply);button('使用此范围',apply,controls);
  for(const section of workbook.sections||[]){const title=el('h4',workbook.selectedSheet+' · '+section.range);body.append(title);const scroll=el('div',undefined,'assembly-file-table'),table=el('table');scroll.append(table);body.append(scroll);for(const row of section.cells||[]){const tr=el('tr');tr.append(el('th',String(row.row)));for(const value of row.values||[])tr.append(el('td',value==null?'':String(value)));table.append(tr);}}
 };
 const update=()=>{const session=U.conversationSession;if(!session)return;const next=JSON.stringify([session.id,refs(),U.p.ui.sectionID,U.p.writingWorkflow?.sections?.[U.p.ui.sectionID]?.referenceMaterialIDs,(U.conversationSessions||[]).map(row=>[row.id,row.title,row.attachments?.length])]);if(next===signature)return;signature=next;
  if(activeID){const reference=refs().find(row=>row.id===activeID);if(activeSession!==session.id||!reference)close();else if(detail&&detailSignature!==detailKey(reference))void openDetail(reference,{view:detail.dataset.view||'info'});}
  render();
 };
 const unsubscribe=S.subscribe(update,{summary:true});U.renderConversationFiles=render;U.previewConversationFile=openDetail;U.closeConversationFile=close;U.refreshConversationFiles=update;update();
 const dispose=()=>{close();fileRail?.destroy();unsubscribe();delete U.renderConversationFiles;delete U.previewConversationFile;delete U.closeConversationFile;delete U.refreshConversationFiles;};win.addEventListener('pagehide',dispose,{once:true});return {render,open:openDetail,close,dispose};
}
