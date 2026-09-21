/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E) {
 const el=(doc,tag,text)=>{const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;return n;};
 const button=(doc,host,label,fn)=>{const n=el(doc,'button',label);n.type='button';n.onclick=fn;host.append(n);return n;};
 E.registerReaderPanes=()=>{
  E.readerPaneIDs=[];
  for(const [id,label,icon,render] of [
   ['research-images','easysch-image-evidence','chrome://zotero/skin/item-type/16/light/attachment-image.svg',E.renderImagePane],
   ['research-references','easysch-paper-references','chrome://zotero/skin/itempane/20/related.svg',E.renderReferencePane]
  ])E.readerPaneIDs.push(Zotero.ItemPaneManager.registerSection({paneID:id,pluginID:E.id,header:{l10nID:label,icon},sidenav:{l10nID:label,icon},onInit:({paneID})=>{if(Zotero.Prefs.get(`panes.${paneID}.open`)===undefined)Zotero.Prefs.set(`panes.${paneID}.open`,false);},onItemChange:({item,setEnabled})=>setEnabled(!!item&&(item.isRegularItem()||item.isPDFAttachment())),onRender:()=>{},onAsyncRender:({body,item})=>render(body,item),onDestroy:({body})=>{body._paneToken=null;body.querySelector('#easysch-asset-panel')?.dispose?.();}}));
 };
 E.renderImagePane=async(body,item)=>{
  if(body._paneItem===item.id&&body.querySelector('#easysch-asset-panel'))return;
  body.querySelector('#easysch-asset-panel')?.dispose?.();body.replaceChildren();body._paneItem=item.id;
  const token=body._paneToken={},attachment=await E.library.localPDF(item);if(body._paneToken!==token)return;
  if(!attachment){body.textContent='暂无本地 PDF，下载附件后可整理图片证据';return;}
  body.dataset.easyschAttachment=attachment.id;
  const win=body.ownerDocument.defaultView,existing=Zotero.Reader.getByTabID(win.Zotero_Tabs?.selectedID);
  const reader=existing?.itemID===attachment.id?existing:{itemID:attachment.id,navigate:location=>E.library.openSource({attachmentID:attachment.id,...location})};
  E.openAssetPanel(reader,null,body);
 };
 E.openImageEvidence=async(attachmentID,focusID)=>{
  const reader=await E.openReaderReady(attachmentID);
  const win=Zotero.getMainWindow();win.ZoteroContextPane.collapsed=false;win.ZoteroContextPane.context.mode='item';
  for(let i=0;i<80;i++){
   const panes=[...win.document.querySelectorAll('item-pane-custom-section')].filter(n=>n.dataset.pane?.includes('research-images')&&n.closest('item-details')?.item?.id===(Zotero.Items.get(attachmentID).parentID||attachmentID));
   const pane=panes.find(n=>n.closest('item-details').getBoundingClientRect().width>0);
   if(pane){pane.open=true;const body=pane._body;if(body)await E.renderImagePane(body,pane.item||Zotero.Items.get(attachmentID));await pane.closest('item-details').scrollToPane(pane.dataset.pane,'instant');const panel=pane.querySelector('#easysch-asset-panel');if(panel){if(focusID)panel.querySelector(`[data-asset-id="${focusID}"]`)?.scrollIntoView({block:'center'});return panel;}}
   await Zotero.Promise.delay(50);
  }
  throw Error('图片证据栏尚未加载，请点击右侧图片证据图标重试');
 };
 // Locate a citation in this paper, never in a downloaded cited paper.
 E.locateReference=async(attachmentID,ref)=>{
  const reader=await E.openReaderReady(attachmentID);const view=reader._internalReader._primaryView;await view.initializedPromise;
  const pdf=view._iframeWindow.PDFViewerApplication.pdfDocument;
  const number=/^\d+$/.test(ref.id)?ref.id:null,words=(ref.quote||ref.title||'').replace(/\s+/g,' ').trim();
  const needle=(ref.title||words.slice(0,65)).toLowerCase();let bibliography;
  for(let i=0;i<pdf.numPages;i++){
   const page=Cu.waiveXrays(await pdf.getPage(i+1)),data=Cu.waiveXrays(await page.getTextContent());
   for(const t of data.items){if(!t.str)continue;const str=t.str.toLowerCase();const match=number&&new RegExp('\\[(?:[\\d,; –-]*[,; –])?'+number+'(?:[,; –][\\d,; –-]*)?\\]').test(t.str);
    if(match||needle&&str.includes(needle)){const h=Math.abs(t.height||t.transform[3]||10),x=t.transform[4],y=t.transform[5],position={pageIndex:i,rects:[[x,y-2,x+Math.max(t.width,4),y+h]]};if(match&&!/^\s*\[\d+\]/.test(t.str)){await reader.navigate({position});return position;}bibliography||=position;}
   }
  }
  if(bibliography){await reader.navigate({position:bibliography});return bibliography;}
  throw Error('未定位到引用位置；可使用阅读器查找原始题录');
 };
 E.renderReferencePane=async(body,item)=>{
  if(body._paneItem===item.id&&body.querySelector('.reference-list'))return;body._paneItem=item.id;body.replaceChildren();const token=body._paneToken={};
  const doc=body.ownerDocument,paper=E.library.describe(item.parentItem||item),status=el(doc,'small','正在读取本文参考文献…'),bar=el(doc,'div'),list=el(doc,'div');list.className='reference-list';bar.className='reference-actions';body.append(bar,status,list);
  let refs=[],resolved=[],attachment;
  const render=()=>{if(body._paneToken!==token)return;list.replaceChildren();for(const ref of refs){
   const record=resolved.find(p=>p.citationOrigins?.some(r=>r.id===ref.id||r.doi&&r.doi===ref.doi)),row=el(doc,'article'),title=el(doc,'button',(ref.id?'['+ref.id+'] ':'')+(record?.title||ref.title||ref.quote)),info=el(doc,'small',record?'已匹配题录 · 可获取公开全文':'尚未匹配 · 保留原始题录');row.className='reference-row';title.className='reference-title';title.title='点击定位本文引用；悬停查看机翻';row.append(title,info);list.append(row);
   const locate=async()=>{try{if(!attachment)throw Error('尚无本地 PDF，无法定位');await E.locateReference(attachment.id,ref);}catch(e){status.textContent=e.message;}};title.onclick=locate;
   let translating=false;const translate=async()=>{if(translating||title.dataset.translated)return;translating=true;try{const r=await E.quickTranslate(record?.title||ref.title||ref.quote);title.title=r.text;title.dataset.translated='true';}catch(e){title.title='机翻暂不可用；原始题录已保留';}finally{translating=false;}};title.onpointerenter=translate;title.onfocus=translate;
   const obtain=async()=>{if(!record){status.textContent='请先匹配题录，未核实来源不会自动下载';return;}try{status.textContent='正在查找公开全文…';await E.obtainPaper(record,{open:false});status.textContent='已保存可用附件；原文引用位置保持不变';}catch(e){status.textContent='全文未获取：'+e.message;}};
   if(record)button(doc,row,'获取全文',obtain);
   row.oncontextmenu=e=>{e.preventDefault();doc.getElementById('easysch-reference-menu')?.remove();const menu=doc.createXULElement('menupopup');menu.id='easysch-reference-menu';doc.querySelector('popupset').append(menu);for(const [label,fn]of [['定位本文引用',locate],['复制题录',()=>Zotero.Utilities.Internal.copyTextToClipboard(ref.quote||ref.title)],['获取公开全文',obtain]]){const m=doc.createXULElement('menuitem');m.setAttribute('label',label);if(label==='获取公开全文'&&!record)m.disabled=true;m.addEventListener('command',fn);menu.append(m);}menu.addEventListener('popuphidden',()=>menu.remove(),{once:true});menu.openPopupAtScreen(e.screenX,e.screenY,true);};
  }};
  const match=button(doc,bar,'匹配题录',async()=>{match.disabled=true;try{const result=await E.collectReferences(paper,{onProgress:p=>{if(body._paneToken===token)status.textContent=`已核对 ${p.done}/${p.total}，匹配 ${p.found} 篇`;}});if(body._paneToken!==token)return;resolved=result.records;refs=result.references||refs;render();status.textContent=`共 ${refs.length} 条 · 已匹配 ${resolved.length} 篇 · ${result.skipped.length} 条保留待核对`;}catch(e){status.textContent=e.message;}finally{match.disabled=false;}});
  try{attachment=await E.library.localPDF(item);if(attachment){const local=await E.referencesFromPDF({id:attachment.id});refs=local.records;render();status.textContent=`本文参考文献 ${refs.length} 条 · 点击定位，悬停机翻`;}else status.textContent='暂无本地 PDF，可匹配出版者登记的参考文献';}catch(e){status.textContent=e.message;}
 };
})(Zotero.Research);
