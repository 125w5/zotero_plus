/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const clone=x=>JSON.parse(JSON.stringify(x));
 const Geometry=ChromeUtils.importESModule('chrome://zotero/content/research/shared/annotation-geometry.mjs');
 E.openReaderReady=async attachmentID=>{
  let reader=await Zotero.Reader.open(attachmentID);
  // Selecting an unloaded/restored Zotero tab deliberately returns undefined.
  // Wait for that tab's reader instead of opening a duplicate.
  for(let i=0;!reader&&i<200;i++){await Zotero.Promise.delay(50);reader=Zotero.Reader._readers.find(r=>r.itemID===attachmentID&&!r._isTabClosed);}
  if(!reader)throw Error('PDF 阅读器未能加载，请重试已有标签');await reader._initPromise;return reader;
 };
 E.readerSelection=reader=>{
  const core=reader._internalReader,view=core?._lastView||core?._primaryView;
  const ranges=view?._selectionRanges;
  let a=ranges?.length&&!ranges[0].collapsed?view._getAnnotationFromSelectionRanges(ranges,'highlight'):null;
  a||=core?._state?.primaryViewSelectionPopup?.annotation||core?._state?.secondaryViewSelectionPopup?.annotation;
  if(!a?.position?.rects?.length)return null;
  const attachment=Zotero.Items.get(reader.itemID);
  return {paperID:attachment.parentID||attachment.id,attachmentID:attachment.id,text:a.text||'',pageIndex:a.position.pageIndex,position:clone(a.position),sortIndex:a.sortIndex};
 };
 E.annotateSelection=(reader,selection,type='highlight')=>{
  if(!selection?.position?.rects?.length)throw Error('请先选择 PDF 文字');
  const core=reader._internalReader;if(core._state.readOnly)throw Error('当前文库只读');
  const positions=type==='strikeout'?Geometry.strikePositions(selection.position):[clone(selection.position)];
  const created=[];
  for(const position of positions){
   if(type!=='strikeout'){position.rects=Geometry.lineRects(position.rects);if(position.nextPageRects)position.nextPageRects=Geometry.lineRects(position.nextPageRects);}
   const a={type:type==='strikeout'?'ink':type,color:type==='strikeout'?'#e33b46':type==='underline'?'#2ea8e5':'#ffd400',text:selection.text,comment:'',position,pageLabel:String(position.pageIndex+1),sortIndex:selection.sortIndex||String(position.pageIndex).padStart(5,'0')+'|000000|00000',tags:type==='strikeout'?[{name:'删除线'}]:[]};
   created.push(core._annotationManager.addAnnotation(Cu.cloneInto(a,reader._iframeWindow)));
  }
  core._lastView?.clearSelection();core._primaryView?.clearSelection();core.setSelectedAnnotations(Cu.cloneInto(created.map(a=>a.id),reader._iframeWindow));return created;
 };
 E.openReaderNote=async(noteID,reader)=>{
  const note=await Zotero.Items.getAsync(noteID);if(!note||note.deleted)throw Error('关联笔记已移入回收站');
  const win=reader?._window||Zotero.getMainWindow(),pane=win.ZoteroContextPane;
  if(!pane?.context)throw Error('请先在中央标签打开 PDF');
  if(reader?.tabID)win.Zotero_Tabs.select(reader.tabID);
  pane.collapsed=false;pane.context.mode='notes';pane.context._selectNotesContext(note.libraryID);
  const context=pane.context._getNotesContext(note.libraryID);context._getCurrentEditor()?.saveSync();context._setPinnedNote(note);pane.updateAddToNote();return context;
 };
 E.noteLinkForAnnotation=(attachmentID,key)=>Object.values(E.store.get('readerNoteLinks')||{}).find(x=>x.attachmentID===attachmentID&&x.annotationKey===key&&Zotero.Items.get(x.noteID)?.deleted===false);
 E.rememberNoteLink=async(annotation,note,extra={})=>{
  const link={noteID:note.id,annotationID:annotation.id,annotationKey:annotation.key,attachmentID:annotation.parentID,pageIndex:JSON.parse(annotation.annotationPosition).pageIndex,...extra};
  await E.store.update(s=>{s.readerNoteLinks||={};s.readerNoteLinks[note.id+':'+annotation.key]=link;});return link;
 };
 E.discoverNoteLinks=async note=>{
  if(!note?.isNote())return;
  const html=note.getNote(),parser=new (Zotero.getMainWindow().DOMParser)(),doc=parser.parseFromString(html,'text/html'),keys=new Set();
  for(const a of doc.querySelectorAll('a[href*="annotation="]')){const k=a.getAttribute('href').match(/[?&]annotation=([A-Z0-9]{8})/);if(k)keys.add(k[1]);}
  for(const a of doc.querySelectorAll('[data-annotation]'))try{const d=JSON.parse(decodeURIComponent(a.dataset.annotation));if(d.annotationKey)keys.add(d.annotationKey);}catch(_){}
  for(const key of keys){const annotation=Zotero.Items.getByLibraryAndKey(note.libraryID,key);if(!annotation?.isAnnotation())continue;const exists=Object.values(E.store.get('readerNoteLinks')||{}).some(x=>x.noteID===note.id&&x.annotationKey===key);if(!exists)await E.rememberNoteLink(annotation,note,{legacy:true});}
 };
 E.notePage=note=>{
  const links=Object.values(E.store.get('readerNoteLinks')||{}).filter(x=>x.noteID===note.id);if(links.length)return Math.min(...links.map(x=>x.pageIndex));
  const pages=[...note.getNote().matchAll(/[?&](?:amp;)?page=(\d+)/g)].map(m=>Number(m[1])-1);return pages.length?Math.min(...pages):Infinity;
 };
 E.syncNoteLinks=async ids=>{
  for(const id of ids){const note=await Zotero.Items.getAsync(id);if(!note?.isNote())continue;await E.discoverNoteLinks(note);
   for(const [key,link]of Object.entries(E.store.get('readerNoteLinks')||{}).filter(([,l])=>l.noteID===id)){
    const annotation=await Zotero.Items.getAsync(link.annotationID);if(!annotation)continue;
    if(note.deleted&&!annotation.deleted){
     // Keep a shared marker when another live note still uses it.
     const other=Object.values(E.store.get('readerNoteLinks')||{}).some(l=>l.annotationID===link.annotationID&&l.noteID!==id&&!Zotero.Items.get(l.noteID)?.deleted);
     if(other)continue;
     await E.store.update(s=>{s.readerNoteLinks[key].trashedWithNote=true;});await Zotero.Items.trashTx(annotation.id);
    }else if(!note.deleted&&annotation.deleted&&link.trashedWithNote){annotation.deleted=false;await annotation.saveTx();await E.store.update(s=>{s.readerNoteLinks[key].trashedWithNote=false;});}
   }
  }
 };
 E.noteFromAnnotation=async(reader,key)=>{
  const attachment=Zotero.Items.get(reader.itemID);let annotation=Zotero.Items.getByLibraryAndKey(attachment.libraryID,key);
  for(let i=0;!annotation&&i<60;i++){await Zotero.Promise.delay(100);annotation=Zotero.Items.getByLibraryAndKey(attachment.libraryID,key);}
  if(!annotation)throw Error('批注尚未保存，请稍候重试');
  const existing=E.noteLinkForAnnotation(reader.itemID,key);if(existing){await E.openReaderNote(existing.noteID,reader);return existing;}
  const note=await Zotero.EditorInstance.createNoteFromAnnotations([annotation],{parentID:attachment.parentID||undefined,collectionID:!attachment.parentID?attachment.getCollections()[0]:undefined});
  const link=await E.rememberNoteLink(annotation,note);await E.openReaderNote(note.id,reader);return link;
 };
 E.saveAssetNote=async asset=>{
  const attachment=await Zotero.Items.getAsync(asset.attachmentID),annotation=new Zotero.Item('annotation');annotation.libraryID=attachment.libraryID;annotation.parentID=attachment.id;annotation.annotationType='image';annotation.annotationColor='#a28ae5';annotation.annotationPosition=JSON.stringify(E.assets.position(asset));annotation.annotationPageLabel=String(asset.pageIndex+1);annotation.annotationSortIndex=String(asset.pageIndex).padStart(5,'0')+'|000000|00000';annotation.annotationComment=asset.label+' · 原图笔记';await annotation.saveTx();
  const note=await Zotero.EditorInstance.createNoteFromAnnotations([annotation],{parentID:attachment.parentID||undefined,collectionID:attachment.getCollections()[0]});
  const m=E.assets.materialFor(asset);if(m?.summary){const parser=new (Zotero.getMainWindow().DOMParser)(),doc=parser.parseFromString(note.getNote(),'text/html'),extra=parser.parseFromString(E.noteContentHTML(m.summary+'\n\n'+(m.imageExplanation?.result.sections||[]).map(s=>'### '+s.heading+'\n'+s.body).join('\n\n')),'text/html'),root=doc.body.firstElementChild;for(const n of [...extra.body.childNodes])root.append(doc.importNode(n,true));note.setNote(doc.body.innerHTML);await note.saveTx();}
  await E.rememberNoteLink(annotation,note);const reader=await E.openReaderReady(attachment.id);await E.openReaderNote(note.id,reader);return {noteID:note.id,annotationID:annotation.id};
 };
 E.selectionImageNote=async(reader,selection)=>{
  if(!selection)throw Error('先框选图片，或选择图内文字');
  const indexed=await E.assets.index(reader.itemID,()=>{}),rects=selection.position.rects;
  const union=[Math.min(...rects.map(r=>r[0])),Math.min(...rects.map(r=>r[1])),Math.max(...rects.map(r=>r[2])),Math.max(...rects.map(r=>r[3]))];
  const candidates=indexed.assets.filter(a=>a.pageIndex===selection.pageIndex&&a.kind!=='formula').map(a=>({a,r:E.assets.position(a).rects[0]})).filter(({r})=>Math.min(r[2],union[2])>Math.max(r[0],union[0])&&Math.min(r[3],union[3])>Math.max(r[1],union[1]));
  const position=candidates.length===1?E.assets.position(candidates[0].a):{pageIndex:selection.pageIndex,rects:[union]};
  const attachment=Zotero.Items.get(reader.itemID),annotation=new Zotero.Item('annotation');annotation.libraryID=attachment.libraryID;annotation.parentID=attachment.id;annotation.annotationType='image';annotation.annotationColor='#2ea8e5';annotation.annotationComment=candidates.length===1?(E.assets.materialFor(candidates[0].a)?.summary||candidates[0].a.caption||'图片批注'):'图片区域批注 · 请核对边界';annotation.annotationPosition=JSON.stringify(position);annotation.annotationPageLabel=String(position.pageIndex+1);annotation.annotationSortIndex=selection.sortIndex||String(position.pageIndex).padStart(5,'0')+'|000000|00000';await annotation.saveTx();await reader.setAnnotations([annotation]);return E.noteFromAnnotation(reader,annotation.key);
 };
 E.installReaderTools=()=>{
  const toolbar=({reader,doc,append})=>{
   if(reader.type!=='pdf')return;
   const b=doc.createElement('button');b.textContent='划掉';b.title='删除线批注 · 先选中文字，再按 Delete';b.style.cssText='width:auto;color:#8d4650;font:inherit;padding:3px 7px';b.onclick=()=>{try{E.annotateSelection(reader,E.readerSelection(reader),'strikeout');}catch(e){b.title=e.message;}};append(b);
   reader._initPromise.then(()=>E.attachReaderInteractions(reader)).catch(e=>Zotero.logError(e));
  };
  const context=({reader,params,append})=>{
   const ids=params.ids||[];for(const id of ids.slice(0,1)){append({label:'打开或保存为笔记',onCommand:()=>E.noteFromAnnotation(reader,id).catch(e=>Zotero.logError(e))});}
  };
  Zotero.Reader.registerEventListener('renderToolbar',toolbar,E.id);Zotero.Reader.registerEventListener('createAnnotationContextMenu',context,E.id);
  E.readerToolHandlers={toolbar,context};
  let queue=Promise.resolve();
  E.noteLinkObserver=Zotero.Notifier.registerObserver({notify(event,type,ids){
   if(type!=='item'||!['add','trash','modify'].includes(event))return;
   const noteIDs=ids.filter(id=>Zotero.Items.get(id)?.isNote());if(!noteIDs.length)return;
   // Run after the notifying transaction; serialize without dropping events.
   E.setTimeout(()=>{queue=queue.then(()=>E.syncNoteLinks(noteIDs)).catch(e=>Zotero.logError(e));},0);
  }},['item'],'easysch-note-links');
 };
 E.installNoteTools=editor=>{
  const doc=editor.ownerDocument,head=editor.querySelector('.custom-head');if(!head||editor.mode!=='edit')return;
  head.querySelector('.easysch-note-insert')?.remove();head.classList.remove('empty');
  const bar=doc.createElementNS('http://www.w3.org/1999/xhtml','div'),add=doc.createElementNS('http://www.w3.org/1999/xhtml','button'),status=doc.createElementNS('http://www.w3.org/1999/xhtml','small');bar.className='easysch-note-insert';bar.style.cssText='display:flex;align-items:center;gap:8px;padding:3px 8px';add.textContent='＋ 插入';add.title='图片、Excel / CSV 表格或公式';add.style.cssText='font:inherit;color:inherit;border:1px solid #8885;border-radius:6px;padding:3px 8px;background:transparent';status.style.cssText='color:GrayText;overflow-wrap:anywhere';bar.append(add,status);head.append(bar);
  add.onclick=()=>{
   const menu=doc.createXULElement('menupopup');editor.querySelector('popupset').append(menu);
   for(const [label,kind]of [['图片…','image'],['导入 Excel / CSV…','data'],['创建表格','table'],['公式','math']]){
    const item=doc.createXULElement('menuitem');item.setAttribute('label',label);item.addEventListener('command',async()=>{add.disabled=true;const instance=editor.getCurrentInstance();try{
     if(kind==='table'||kind==='math'){await E.insertNoteStructure(editor,kind);return;}
     const path=await E.pick(doc.defaultView,label,'file',kind==='image'?'png;jpg;jpeg;webp':'csv;xlsx');if(!path)return;
     status.textContent='正在插入…';
     await E.insertNoteFile(editor,path,kind);status.textContent='已插入 · Ctrl+Z 可撤销';
    }catch(e){status.textContent=e.message;}finally{add.disabled=false;}});menu.append(item);
   }
   menu.addEventListener('popuphidden',()=>menu.remove(),{once:true});menu.openPopup(add,'after_start');
  };
 };
 E.insertNoteStructure=async(editor,kind)=>{
  const instance=editor.getCurrentInstance();await instance._initPromise;
  if(editor.getCurrentInstance()!==instance)throw Error('当前笔记已切换，请重新插入');
  // Table/math commands belong to the editor's context-menu protocol, not
  // top-level messages. They use its saved selection even while this menu has focus.
  instance._postMessage({action:'contextMenuAction',ctxAction:kind==='table'?'insertTable':'insertMath',pos:0});
 };
 E.insertNoteFile=async(editor,path,kind)=>{
  const instance=editor.getCurrentInstance(),noteID=editor.item?.id;await instance._initPromise;
  let html='';const h=E.core.escapeHTML;
  if(kind==='image'){
   const src=await E.previewImage(path);await instance._ensureNoteCreated();const key=await instance._importImage(src);if(!key)throw Error('图片未能保存到笔记');
   html='<p><img data-attachment-key="'+h(key)+'" alt="'+h(PathUtils.filename(path))+'" width="480"></p><p></p>';
  }else{
   const data=await E.manuscripts.dataset(path);if(!data.rows?.length)throw Error('数据表为空');
   html='<table style="border-collapse:collapse;width:100%"><tbody>'+data.rows.map((row,i)=>'<tr>'+row.map(cell=>'<'+(i?'td':'th')+' style="border:1px solid #8b9298;padding:6px"><p>'+h(String(cell??''))+'</p></'+(i?'td':'th')+'>').join('')+'</tr>').join('')+'</tbody></table><p></p>';
  }
  if(editor.getCurrentInstance()!==instance||noteID&&editor.item?.id!==noteID)throw Error('当前笔记已切换，请返回原笔记重新插入');
  instance._postMessage({action:'insertHTML',pos:null,html});return html;
 };
 E.attachReaderInteractions=async reader=>{
  const view=reader._internalReader?._primaryView;if(!view)return;await view.initializedPromise;
  const win=Cu.unwaiveXrays(view._iframeWindow),doc=win?.document;if(!doc||doc._easyschInteractions)return;doc._easyschInteractions=true;
  const parent=Zotero.Items.get(reader.itemID)?.parentItem;E._noteMigrationJobs||=new Map();if(parent&&!E._noteMigrationJobs.has(parent.id))E._noteMigrationJobs.set(parent.id,(async()=>{for(const note of Zotero.Items.get(parent.getNotes()))await E.discoverNoteLinks(note);})().catch(e=>{E._noteMigrationJobs.delete(parent.id);Zotero.logError(e);}));
  let timer,hideTimer,currentID;const outer=reader._iframeWindow.document,tip=outer.createElement('div');tip.className='easysch-annotation-hover';tip.hidden=true;tip.style.cssText='position:fixed;z-index:11000;width:300px;max-width:70vw;max-height:240px;overflow:auto;padding:12px;background:Canvas;color:CanvasText;border:1px solid #a8adb4;border-radius:10px;box-shadow:0 5px 20px #0002;line-height:1.6;font:13px/1.6 system-ui;user-select:text';outer.body.append(tip);
  const hide=()=>{E.clearTimeout(timer);E.clearTimeout(hideTimer);hideTimer=E.setTimeout(()=>{tip.hidden=true;currentID=null;},250);};tip.onpointerenter=()=>E.clearTimeout(hideTimer);tip.onpointerleave=hide;
  const hit=e=>{const p=view.pointerEventToPosition(e);return p&&view.getSelectableAnnotations(p)?.find(a=>a.comment||a.text||E.noteLinkForAnnotation(reader.itemID,a.id));};
  doc.addEventListener('pointermove',e=>{if(e.buttons||view._selectionRanges?.some(r=>!r.collapsed)){hide();return;}const a=hit(e);if(!a){hide();return;}E.clearTimeout(hideTimer);if(currentID===a.id&&!tip.hidden)return;E.clearTimeout(timer);const x=e.clientX,y=e.clientY;timer=E.setTimeout(()=>{
   currentID=a.id;tip.replaceChildren();const link=E.noteLinkForAnnotation(reader.itemID,a.id),title=outer.createElement('small');title.textContent=link?'关联笔记 · 双击打开':'批注';title.style.color='GrayText';tip.append(title);
   const isGenerated=link?.generatedComment===a.comment||link?.translation&&a.comment?.endsWith(link.translation);
   if(link?.translation){const translated=outer.createElement('div');translated.textContent=link.translation;translated.style.cssText=isGenerated?'font-size:13px':'font-size:12px;color:GrayText';tip.append(translated);}
   if(!isGenerated){const body=outer.createElement('div');body.textContent=a.comment||'';tip.append(body);}
   if(a.text&&!link?.translation){const translated=outer.createElement('small');translated.style.cssText='display:block;color:GrayText;font-size:12px';tip.prepend(translated);E.quickTranslate(a.text).then(r=>{if(currentID===a.id)translated.textContent=r.text;}).catch(()=>{});}
   if(link){
    const note=Zotero.Items.get(link.noteID),preview=outer.createElement('div');preview.style.cssText='max-height:140px;overflow:auto;font-size:12px;color:GrayText';
    // Sanitize the current note excerpt; hover never loads external images.
    const parsed=new outer.defaultView.DOMParser().parseFromString(note.getNote(),'text/html');
    for(const math of parsed.querySelectorAll('pre.math')){const p=parsed.createElement('p');p.textContent=math.textContent;math.replaceWith(p);}
    E.renderContent(preview,parsed.body.innerHTML);tip.append(preview);
    const b=outer.createElement('button');b.textContent='打开笔记';b.onclick=()=>{tip.hidden=true;E.openReaderNote(link.noteID,reader);};tip.append(b);
   }
   const r=view._iframe.getBoundingClientRect?.()||{left:0,top:40};tip.style.left=Math.max(8,Math.min(r.left+x+14,outer.defaultView.innerWidth-320))+'px';tip.style.top=Math.max(45,Math.min(r.top+y+18,outer.defaultView.innerHeight-250))+'px';tip.hidden=false;
  },260);},{passive:true});
  doc.addEventListener('dblclick',e=>{const a=hit(e),link=a&&E.noteLinkForAnnotation(reader.itemID,a.id);if(link){e.preventDefault();E.openReaderNote(link.noteID,reader).catch(e=>Zotero.logError(e));}},true);
  win.addEventListener('unload',()=>{E.clearTimeout(timer);E.clearTimeout(hideTimer);tip.remove();},{once:true});
 };
})(Zotero.Research);
