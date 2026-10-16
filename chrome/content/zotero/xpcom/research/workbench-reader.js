/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const mounts=new WeakMap(),number=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
 const element=(doc,tag,text,className)=>{const node=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 const attachmentFor=async row=>{
  const explicit=number(row.attachmentID||row.anchor?.attachmentID),itemID=explicit||number(row.zoteroItemID||row.itemID||row.paperItemID||row.sourceItemID||row.anchor?.paperItemID||row.id);
  if(!itemID)return null;let item=await Zotero.Items.getAsync(itemID);if(item?.isAnnotation?.())item=await Zotero.Items.getAsync(item.parentID);
  if(!item||item.deleted||explicit&&!item.isPDFAttachment?.())return null;return E.library.localPDF(item);
 };
 // Research previews do not instantiate a second PDF reader. Editing and
 // navigation always use the existing native reader, opened explicitly.
 E.mountWorkbenchSourcePane=async(host,row,tab,{signal}={})=>{
  if(!['images','annotations','references'].includes(tab))throw Error('原文请在 PDF 阅读器中打开');
  mounts.get(host)?.cleanup();const doc=host.ownerDocument,win=doc.defaultView,root=element(doc,'section',undefined,'workbench-source-pane');root.dataset.sourceTab=tab;
  const resources=[];let disposed=false,generation=0;const session={cleanup};
  const valid=()=>!disposed&&!signal?.aborted&&mounts.get(host)===session&&root.isConnected;
  function cleanup(){if(disposed)return;disposed=true;generation++;for(const off of resources.splice(0).reverse()){try{off();}catch(error){Zotero.logError(error);}}signal?.removeEventListener('abort',cleanup);win.removeEventListener('unload',cleanup);root.remove();if(mounts.get(host)===session)mounts.delete(host);}
  mounts.set(host,session);if(signal?.aborted){cleanup();return cleanup;}signal?.addEventListener('abort',cleanup,{once:true});win.addEventListener('unload',cleanup,{once:true});host.replaceChildren(root);
  const message=text=>{const p=element(doc,'p',text,'agent-empty');root.replaceChildren(p);return p;};message('正在读取…');
  async function mount(attachment){
   if(!valid())return;root.replaceChildren();root.dataset.attachmentId=String(attachment.id);
   const body=element(doc,'div',undefined,'workbench-source-content');root.append(body);
   if(tab==='images'){
    const facade={itemID:attachment.id,researchPreviewOnly:true,navigate:location=>valid()&&E.library.openSource({...location,attachmentID:attachment.id})};
    const panel=E.openAssetPanel(facade,row.assetID||row.anchor?.assetID,body);resources.push(()=>{panel?.dispose?.();panel?.remove();});
   }
   else if(tab==='references'){
    resources.push(()=>{body._paneToken=null;body._referenceDispose?.();});await E.renderReferencePane(body,attachment);
   }
   else{
    const {annotationPresentation}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/annotation-presentation.mjs');
    async function render(){
     const token=++generation,annotations=attachment.getAnnotations().filter(annotation=>!annotation.deleted).sort((a,b)=>String(a.annotationSortIndex||'').localeCompare(String(b.annotationSortIndex||'')));
     if(!valid())return;const nodes=[];
     for(const annotation of annotations){
      const data=await Zotero.Annotations.toJSON(annotation);if(!valid()||generation!==token)return;
      const presentation=annotationPresentation(data,E.noteLinkForAnnotation?.(attachment.id,annotation.key));
      const card=element(doc,'article',undefined,'workbench-annotation-card');card.dataset.annotationId=annotation.key;card.style.setProperty('--annotation-color',presentation.color);
      const header=element(doc,'header'),label=element(doc,'span','第 '+(annotation.annotationPageLabel||1)+' 页','workbench-annotation-page'),open=element(doc,'button','↗','workbench-annotation-open');open.type='button';open.title='在阅读器中定位批注';open.setAttribute('aria-label',open.title);
      open.onclick=()=>E.library.openSource({attachmentID:attachment.id,annotationID:annotation.key}).catch(Zotero.logError);header.append(label,open);card.append(header);
      if(data.image){const image=element(doc,'img');image.src=data.image;image.alt='第 '+(annotation.annotationPageLabel||1)+' 页的图片批注';card.append(image);}
      if(data.text){const quote=element(doc,'div',undefined,'workbench-annotation-quote');E.renderContent(quote,data.text);card.append(quote);}
      if(presentation.text){const comment=element(doc,'div',undefined,'workbench-annotation-comment');comment.classList.toggle('translation',presentation.translation);E.renderContent(comment,presentation.text);card.append(comment);}
      card.ondblclick=event=>{if(!event.target.closest('button,a'))open.click();};nodes.push(card);
     }
     if(valid()&&generation===token){const scroll=body.scrollTop;body.replaceChildren(...nodes);if(!nodes.length)body.append(element(doc,'p','这篇论文还没有批注。','agent-empty'));body.scrollTop=scroll;}
    }
    const observer=Zotero.Notifier.registerObserver({async notify(event,type,ids){if(type!=='item'||!valid())return;if(['delete','trash'].includes(event)&&(ids.includes(attachment.id)||ids.includes(attachment.parentID))){cleanup();return;}if(['add','modify','delete','trash'].includes(event))try{await render();}catch(error){if(valid())Zotero.logError(error);}}},['item'],'workbench-annotation-list');
    resources.push(()=>Zotero.Notifier.unregisterObserver(observer));await render();
   }
  }
  try{
   const attachment=await attachmentFor(row);if(!valid())return cleanup;
   if(attachment)await mount(attachment);
   else{
    message('暂无本地 PDF；题录与摘要仍保留。');
    if(typeof E.obtainPaper==='function'&&(row.doi||row.pdf||row.url)){
     const button=element(doc,'button','获取公开全文','agent-text-action');button.type='button';root.append(button);
     button.onclick=async()=>{if(!valid()||button.disabled)return;button.disabled=true;button.textContent='正在获取…';try{const result=await E.obtainPaper(row,{open:false});if(!valid())return;const obtained=await attachmentFor({attachmentID:result.attachmentID});if(!valid())return;if(!obtained)throw Error('附件保存完成，但本地 PDF 暂不可用');await mount(obtained);}catch(error){if(valid()){message(error.message);button.disabled=false;button.textContent='重试获取公开全文';root.append(button);}}};
    }
   }
   if(!valid())cleanup();return cleanup;
  }catch(error){cleanup();if(signal?.aborted)return cleanup;throw error;}
 };
})(Zotero.Research);
