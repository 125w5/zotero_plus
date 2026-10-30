/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {visibleComments,assetAtPoint} from './rapid-reading-data.mjs';
import {readingStyle} from './reader-rapid-reading.mjs';
import {annotationPresentation,editedAnnotationComment} from './annotation-presentation.mjs';
import {marginCommentLayout} from './comment-layout.mjs';
const HTML='http://www.w3.org/1999/xhtml';
export async function installMarginComments(E,reader,view,{Zotero,Cu}){
 const win=Cu.unwaiveXrays(view._iframeWindow),pdfWin=Cu.waiveXrays(view._iframeWindow),doc=win.document,container=doc.getElementById('viewerContainer');if(!container)return ()=>{};
 const outer=reader._iframeWindow;await Promise.all([readingStyle(doc,{Zotero}),readingStyle(outer.document,{Zotero}),E.prepareContentStyles(doc),E.prepareContentStyles(outer.document)]);
 const core=()=>Cu.waiveXrays(reader._internalReader);
 const node=(tag,cls,parent)=>{const n=doc.createElementNS(HTML,tag);n.className=cls;parent?.append(n);return n;};
 const lane=node('aside','easysch-comment-lane',doc.body),map=node('aside','easysch-comment-map',doc.body),toggle=node('button','easysch-margin-toggle',doc.body);
 lane.id='easysch-comment-lane-'+reader.itemID;lane.setAttribute('aria-label','页外批注');map.setAttribute('aria-label','批注位置');toggle.type='button';toggle.setAttribute('aria-controls',lane.id);
 const icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 20 20');icon.setAttribute('aria-hidden','true');
 const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M5 3.5h10A2.5 2.5 0 0 1 17.5 6v6a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3v-3A2.5 2.5 0 0 1 2 12V6a2.5 2.5 0 0 1 3-2.5ZM6 7h7M6 10.5h5');icon.append(path);toggle.append(icon);
 const label=node('span','easysch-margin-label',toggle),count=node('span','easysch-margin-count',toggle),chevron=node('span','easysch-margin-chevron',toggle);label.textContent='批注';chevron.setAttribute('aria-hidden','true');
 let disposed=false,frame=null,expanded=true,translation=!!outer.document.querySelector('.easysch-page-translation'),railWidth=228,cachedComments=null;const cards=new Map();
 const cardObserver=new win.ResizeObserver(entries=>{let changed=false;for(const entry of entries){const state=cards.get(entry.target.dataset.annotationId);if(!state||entry.target.hidden)continue;const height=entry.borderBoxSize?.[0]?.blockSize||entry.target.getBoundingClientRect().height;if(height>0&&Math.abs((state.height||0)-height)>.5){state.height=height;changed=true;}}if(changed)schedule();});
 const render=()=>{
  frame=null;if(disposed)return;const comments=cachedComments||=visibleComments(Array.from(core()?._state?.annotations||[],annotation=>Cu.waiveXrays(annotation)),id=>E.noteLinkForAnnotation(reader.itemID,id));
  const suppressed=translation||!!outer.document.querySelector('.easysch-rapid-reading');toggle.hidden=!comments.length||suppressed;lane.hidden=!comments.length||suppressed||!expanded;count.textContent=String(comments.length);toggle.setAttribute('aria-expanded',String(expanded&&!suppressed));toggle.title=expanded?'收起页外批注':'展开页外批注';toggle.setAttribute('aria-label',toggle.title+'，共 '+comments.length+' 条');
  // These are document overlays. Never reserve viewer width or refit PDF.js:
  // showing a note must preserve the reader's scale, page position and selection.
  railWidth=Math.max(140,Math.min(win.innerWidth<620?196:228,win.innerWidth-32));lane.style.width=railWidth+'px';map.hidden=toggle.hidden;const keep=new Set(),positions=[];
  for(const {annotation:a,link}of comments){keep.add(a.id);let state=cards.get(a.id);if(!state){const card=node('article','easysch-margin-card',lane),connector=node('i','easysch-comment-connector',lane),marker=node('button','easysch-comment-marker',map),header=node('header','',card),page=node('span','easysch-margin-page',header),edit=node('button','easysch-margin-edit',header),body=node('div','easysch-margin-body',card);card.dataset.annotationId=a.id;marker.type='button';marker.onclick=()=>{expanded=true;schedule();reader.navigate({annotationID:a.id});};edit.type='button';edit.textContent='编辑';edit.title='编辑批注';state={card,connector,marker,page,body,a,editing:false};cards.set(a.id,state);edit.addEventListener('click',()=>{
    if(state.editing)return;state.editing=true;state.body.hidden=true;edit.hidden=true;
    const input=node('textarea','',card),actions=node('footer','easysch-margin-actions',card),cancel=node('button','',actions),save=node('button','',actions),error=node('div','easysch-margin-error',card);error.hidden=true;error.setAttribute('role','alert');
    let shown=annotationPresentation(state.a,E.noteLinkForAnnotation(reader.itemID,a.id));input.setAttribute('aria-label','编辑批注内容');input.value=shown.text;cancel.type=save.type='button';cancel.textContent='取消';save.textContent='保存';save.className='easysch-margin-save';
    const finish=()=>{state.editing=false;state.body.hidden=false;edit.hidden=false;input.remove();actions.remove();error.remove();cachedComments=null;state.height=null;schedule();};cancel.addEventListener('click',finish);
    save.addEventListener('click',async()=>{if(input.value===shown.text){finish();return;}save.disabled=cancel.disabled=true;error.hidden=true;try{await reader._internalReader._annotationManager.updateAnnotations(Cu.cloneInto([{id:a.id,comment:editedAnnotationComment(shown,input.value)}],reader._iframeWindow));finish();}catch(cause){save.disabled=cancel.disabled=false;error.textContent='未能保存，请重试';error.hidden=false;Zotero.logError(cause);}});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();finish();}else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();save.click();}});schedule();input.focus();
   });cardObserver.observe(card);card.addEventListener('click',e=>{if(!e.target.closest('button,textarea')&&!doc.getSelection()?.toString())reader.navigate({annotationID:a.id});});}
   const display=annotationPresentation(a,link);state.a=a;state.page.textContent='第 '+(a.position.pageIndex+1)+' 页';state.card.dataset.generated=display.translation?'translation':'comment';for(const part of [state.card,state.connector,state.marker])part.style.setProperty('--comment-color',display.color);state.marker.title='第 '+(a.position.pageIndex+1)+' 页 · '+display.text.slice(0,100);state.marker.setAttribute('aria-label',state.marker.title);if(!state.editing&&state.body.dataset.text!==display.text){E.renderContent(state.body,display.text);state.body.dataset.text=display.text;state.height=null;}
   const page=pdfWin.PDFViewerApplication?.pdfViewer?._pages?.[a.position.pageIndex],r=a.position.rects?.[0],box=r&&page?.viewport.convertToViewportRectangle(r),pageRect=page?.div.getBoundingClientRect();
   if(page?.div&&box)state.marker.style.top=Math.min(99,Math.max(1,100*(page.div.offsetTop+Math.min(box[1],box[3]))/Math.max(1,container.scrollHeight)))+'%';
   const anchorY=pageRect&&box?pageRect.top+Math.min(box[1],box[3]):null,anchorBottom=pageRect&&box?pageRect.top+Math.max(box[1],box[3]):null;
   if(!pageRect||!box||anchorBottom<38||anchorY>win.innerHeight-8){state.card.hidden=true;state.connector.hidden=true;continue;}
   state.card.hidden=false;state.connector.hidden=false;if(state.width!==railWidth){state.card.style.width=railWidth+'px';state.width=railWidth;state.height=null;}
   // Typing in a fixed-size textarea does not change its card's geometry.
   // Reuse the measured card height on scroll instead of forcing a layout for
   // every annotation on every frame while a PDF selection/editor is active.
   if(state.height===null||state.height===undefined||state.wasEditing!==state.editing){state.height=state.card.getBoundingClientRect().height;state.wasEditing=state.editing;}
   positions.push({id:a.id,pageIndex:a.position.pageIndex,anchorY,pageRight:pageRect.right,height:state.height,state});
  }
  const placed=marginCommentLayout(positions,{viewportWidth:win.innerWidth,viewportHeight:win.innerHeight,width:railWidth,padding:16,top:58}),laneLeft=placed.length?Math.min(...placed.map(entry=>entry.left)):Math.max(16,win.innerWidth-railWidth-16);lane.style.left=laneLeft+'px';
  for(const {state,left,top,anchorY,pageRight}of placed){state.card.style.left=(left-laneLeft)+'px';state.card.style.top=top+'px';state.connector.style.left=(Math.min(pageRight,left)-laneLeft)+'px';state.connector.style.top=Math.max(58,anchorY)+'px';state.connector.style.width=Math.max(0,left-pageRight)+'px';}
  for(const [id,state]of cards)if(!keep.has(id)){cardObserver.unobserve(state.card);state.card.remove();state.connector.remove();state.marker.remove();cards.delete(id);}
 };
 const schedule=()=>{if(!disposed&&frame===null)frame=win.requestAnimationFrame(()=>{try{render();}catch(error){frame=null;Zotero.logError(error);}});};
 const dataChanged=()=>{cachedComments=null;schedule();};
 toggle.addEventListener('click',()=>{expanded=!expanded;schedule();});
 const layout=event=>{translation=!!event.detail?.translation;schedule();};outer.addEventListener('easysch-reader-layoutchange',layout);outer.addEventListener('easysch-reader-annotationschange',dataChanged);
 container.addEventListener('scroll',schedule,{passive:true});win.addEventListener('resize',schedule);
 const notifier=Zotero.Notifier.registerObserver({notify(event,type,ids,extraData){if(type==='item'&&ids.some(id=>{const item=Zotero.Items.get(id);return item?.parentID===reader.itemID||id===reader.itemID||cards.has(extraData?.[id]?.key);}))dataChanged();}},['item'],'easysch-margin-comments');
 const observer=new outer.MutationObserver(schedule);observer.observe(outer.document.body,{childList:true});
 let pressed=null;const down=e=>{if(e.button!==0)return;pressed={x:e.clientX,y:e.clientY};};
 const click=e=>{if(!pressed||e.button!==0||Math.hypot(e.clientX-pressed.x,e.clientY-pressed.y)>4||e.target.closest('a,.easysch-margin-card,button,textarea')||view._selectionRanges?.some(r=>!r.collapsed))return;const type=reader._internalReader?._state?.tool?.type;if(type&&type!=='pointer')return;
  const currentAssets=(E.assets.active.get(reader.itemID)?.assets||[]).filter(a=>!a.attachmentID||a.attachmentID===reader.itemID);
  const asset=assetAtPoint(currentAssets,view.pointerEventToPosition(e),a=>E.assets.position(a));if(asset&&E.openReaderEvidenceDetail){e.preventDefault();e.stopPropagation();Promise.resolve(E.openReaderEvidenceDetail(reader,asset)).catch(Zotero.logError);}};
 doc.addEventListener('pointerdown',down,true);doc.addEventListener('click',click,true);schedule();
 const dispose=()=>{if(disposed)return;disposed=true;if(frame!==null)win.cancelAnimationFrame(frame);observer.disconnect();cardObserver.disconnect();Zotero.Notifier.unregisterObserver(notifier);lane.remove();map.remove();toggle.remove();container.removeEventListener('scroll',schedule);win.removeEventListener('resize',schedule);outer.removeEventListener('easysch-reader-layoutchange',layout);outer.removeEventListener('easysch-reader-annotationschange',dataChanged);doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('click',click,true);};win.addEventListener('unload',dispose,{once:true});return dispose;
}
