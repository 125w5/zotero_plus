/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {visibleComments,assetAtPoint} from './rapid-reading-data.mjs';
import {readingStyle} from './reader-rapid-reading.mjs';
import {annotationPresentation} from './annotation-presentation.mjs';
import {marginCommentLayout} from './comment-layout.mjs';
const HTML='http://www.w3.org/1999/xhtml';
export async function installMarginComments(E,reader,view,{Zotero,Cu}){
 const win=Cu.unwaiveXrays(view._iframeWindow),pdfWin=Cu.waiveXrays(view._iframeWindow),doc=win.document,container=doc.getElementById('viewerContainer');if(!container)return ()=>{};
 const outer=reader._iframeWindow;await Promise.all([readingStyle(doc,{Zotero}),readingStyle(outer.document,{Zotero}),E.prepareContentStyles(doc),E.prepareContentStyles(outer.document)]);
 const core=()=>Cu.waiveXrays(reader._internalReader);
 const node=(tag,cls,parent)=>{const n=doc.createElementNS(HTML,tag);n.className=cls;parent?.append(n);return n;};
 const lane=node('aside','easysch-comment-lane',doc.body),map=node('aside','easysch-comment-map',doc.body),toggle=node('button','easysch-margin-toggle',doc.body);map.setAttribute('aria-label','批注位置');toggle.type='button';toggle.title='页外批注';toggle.setAttribute('aria-label','展开或收起页外批注');toggle.textContent='批注';
 let disposed=false,frame=null,expanded=true,translation=!!outer.document.querySelector('.easysch-page-translation'),priorRight=container.style.right,reserved=false,railWidth=178;const cards=new Map();
 const setReserved=value=>{
  const nextWidth=win.innerWidth<620?148:178;if(reserved===value&&railWidth===nextWidth)return;reserved=value;railWidth=nextWidth;lane.style.width=railWidth+'px';container.style.right=value?(railWidth+12)+'px':priorRight;
  // A container ResizeObserver updates PDF.js visibility, but does not refit
  // automatic paper zoom. Refit those modes without changing manual zoom.
  const viewer=pdfWin.PDFViewerApplication?.pdfViewer,scale=viewer?.currentScaleValue;
  if(viewer){if(['auto','page-fit','page-width'].includes(scale))viewer.currentScaleValue=scale;viewer.update();}
  schedule();
 };
 const render=()=>{
  frame=null;if(disposed)return;const annotations=Array.from(core()?._state?.annotations||[],annotation=>Cu.waiveXrays(annotation)),comments=visibleComments(annotations,id=>E.noteLinkForAnnotation(reader.itemID,id));
  const suppressed=translation||!!outer.document.querySelector('.easysch-rapid-reading');toggle.hidden=!comments.length||suppressed;lane.hidden=!comments.length||suppressed||!expanded;toggle.textContent=expanded?'批注':'批注 '+comments.length;toggle.setAttribute('aria-expanded',String(expanded&&!suppressed));
  map.hidden=toggle.hidden;setReserved(!lane.hidden);const keep=new Set(),positions=[];
  for(const {annotation:a,link}of comments){keep.add(a.id);let state=cards.get(a.id);if(!state){const card=node('article','easysch-margin-card',lane),connector=node('i','easysch-comment-connector',lane),marker=node('button','easysch-comment-marker',map),header=node('header','',card),page=node('span','',header),edit=node('button','',header),body=node('div','',card);card.dataset.annotationId=a.id;marker.type='button';marker.onclick=()=>reader.navigate({annotationID:a.id});edit.type='button';edit.textContent='编辑';edit.title='编辑批注';state={card,connector,marker,page,body,a,editing:false};cards.set(a.id,state);edit.addEventListener('click',()=>{if(state.editing)return;state.editing=true;const input=node('textarea','',card),save=node('button','',card);input.value=annotationPresentation(state.a,E.noteLinkForAnnotation(reader.itemID,a.id)).text;save.type='button';save.textContent='保存';input.focus();save.addEventListener('click',()=>{reader._internalReader._annotationManager.updateAnnotations(Cu.cloneInto([{id:a.id,comment:input.value}],reader._iframeWindow));state.editing=false;input.remove();save.remove();schedule();});});card.addEventListener('click',e=>{if(!e.target.closest('button,textarea'))reader.navigate({annotationID:a.id});});}
   const display=annotationPresentation(a,link);state.a=a;state.page.textContent='第 '+(a.position.pageIndex+1)+' 页';state.card.dataset.generated=display.translation?'translation':'comment';for(const part of [state.card,state.connector,state.marker])part.style.setProperty('--comment-color',display.color);state.marker.title='第 '+(a.position.pageIndex+1)+' 页 · '+display.text.slice(0,100);state.marker.setAttribute('aria-label',state.marker.title);if(!state.editing&&state.body.dataset.text!==display.text){E.renderContent(state.body,display.text);state.body.dataset.text=display.text;}
   const page=pdfWin.PDFViewerApplication?.pdfViewer?._pages?.[a.position.pageIndex],r=a.position.rects?.[0],box=r&&page?.viewport.convertToViewportRectangle(r),pageRect=page?.div.getBoundingClientRect();
   if(page?.div&&box)state.marker.style.top=Math.min(99,Math.max(1,100*(page.div.offsetTop+Math.min(box[1],box[3]))/Math.max(1,container.scrollHeight)))+'%';
   const anchorY=pageRect&&box?pageRect.top+Math.min(box[1],box[3]):null,anchorBottom=pageRect&&box?pageRect.top+Math.max(box[1],box[3]):null;
   if(!pageRect||!box||anchorBottom<38||anchorY>win.innerHeight-8){state.card.hidden=true;state.connector.hidden=true;continue;}
   state.card.hidden=false;state.connector.hidden=false;state.card.style.width=railWidth+'px';
   positions.push({id:a.id,pageIndex:a.position.pageIndex,anchorY,pageRight:pageRect.right,height:state.card.getBoundingClientRect().height,state});
  }
  const placed=marginCommentLayout(positions,{viewportWidth:win.innerWidth,viewportHeight:win.innerHeight,width:railWidth}),laneLeft=placed.length?Math.min(...placed.map(entry=>entry.left)):Math.max(8,win.innerWidth-railWidth-8);lane.style.left=laneLeft+'px';
  for(const {state,left,top,anchorY,pageRight}of placed){state.card.style.left=(left-laneLeft)+'px';state.card.style.top=top+'px';state.connector.style.left=(Math.min(pageRight,left)-laneLeft)+'px';state.connector.style.top=Math.max(38,anchorY)+'px';state.connector.style.width=Math.max(0,left-pageRight)+'px';}
  for(const [id,state]of cards)if(!keep.has(id)){state.card.remove();state.connector.remove();state.marker.remove();cards.delete(id);}
 };
 const schedule=()=>{if(!disposed&&frame===null)frame=win.requestAnimationFrame(()=>{try{render();}catch(error){frame=null;Zotero.logError(error);}});};
 toggle.addEventListener('click',()=>{expanded=!expanded;schedule();});
 const layout=event=>{translation=!!event.detail?.translation;schedule();};outer.addEventListener('easysch-reader-layoutchange',layout);outer.addEventListener('easysch-reader-annotationschange',schedule);
 container.addEventListener('scroll',schedule,{passive:true});win.addEventListener('resize',schedule);
 const notifier=Zotero.Notifier.registerObserver({notify(event,type,ids,extraData){if(type==='item'&&ids.some(id=>{const item=Zotero.Items.get(id);return item?.parentID===reader.itemID||id===reader.itemID||cards.has(extraData?.[id]?.key);}))schedule();}},['item'],'easysch-margin-comments');
 const observer=new outer.MutationObserver(schedule);observer.observe(outer.document.body,{childList:true});
 let pressed=null;const down=e=>{if(e.button!==0)return;pressed={x:e.clientX,y:e.clientY};};
 const click=e=>{if(!pressed||e.button!==0||Math.hypot(e.clientX-pressed.x,e.clientY-pressed.y)>4||e.target.closest('a,.easysch-margin-card,button,textarea')||view._selectionRanges?.some(r=>!r.collapsed))return;const type=reader._internalReader?._state?.tool?.type;if(type&&type!=='pointer')return;
  const currentAssets=(E.assets.active.get(reader.itemID)?.assets||[]).filter(a=>!a.attachmentID||a.attachmentID===reader.itemID);
  const asset=assetAtPoint(currentAssets,view.pointerEventToPosition(e),a=>E.assets.position(a));if(asset&&E.openReaderEvidenceDetail){e.preventDefault();e.stopPropagation();Promise.resolve(E.openReaderEvidenceDetail(reader,asset)).catch(Zotero.logError);}};
 doc.addEventListener('pointerdown',down,true);doc.addEventListener('click',click,true);schedule();
 const dispose=()=>{if(disposed)return;disposed=true;if(frame!==null)win.cancelAnimationFrame(frame);observer.disconnect();Zotero.Notifier.unregisterObserver(notifier);container.style.right=priorRight;lane.remove();map.remove();toggle.remove();container.removeEventListener('scroll',schedule);win.removeEventListener('resize',schedule);outer.removeEventListener('easysch-reader-layoutchange',layout);outer.removeEventListener('easysch-reader-annotationschange',schedule);doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('click',click,true);};win.addEventListener('unload',dispose,{once:true});return dispose;
}
