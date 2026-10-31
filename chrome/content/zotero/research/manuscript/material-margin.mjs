/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Like the reader, annotations are a right-side overlay. Showing an annotation
// must never resize the paper or move the text that the user just selected.
const rails=new WeakMap(),styledDocuments=new WeakSet();
export function materialMarginGeometry({innerWidth,pageRight=0,padding=8}){
 innerWidth=Math.max(1,Number(innerWidth)||1);padding=Math.min(padding,Math.max(0,(innerWidth-1)/2));
 const railWidth=Math.max(1,Math.min(innerWidth<620?196:228,innerWidth-padding*2)),gap=8,left=Math.max(padding,Math.min(pageRight+gap,innerWidth-railWidth-padding));
 // Without room beside the paper the rail is clamped onto the text. Saved
 // comments then collapse to a count badge and open only on request.
 return {railWidth,gap,left,compact:left<pageRight+gap-.5};
}
export function materialMarginToggleLabel(count,expanded){return expanded?'收起批注':'批注 '+count;}
export function installMaterialMargin(card){
 const doc=card.ownerDocument,win=doc.defaultView,canvas=doc.getElementById('canvas');let state=rails.get(canvas);
 // Every card of a canvas render comes through here: look the sheet up once per document.
 if(!styledDocuments.has(doc)){styledDocuments.add(doc);if(!doc.querySelector('link[data-material-overview],link[href$="refined-surface.css"]')){const link=doc.createElement('link');link.rel='stylesheet';link.href='chrome://zotero/content/research/manuscript/material-overview.css';link.dataset.materialOverview='true';doc.head.append(link);}}
 if(!state){
  const lane=doc.createElement('div');lane.className='assembly-material-margin';lane.setAttribute('aria-label','素材页外批注');canvas.append(lane);
  state={lane,entries:new Set(),frame:null};rails.set(canvas,state);
  const layout=()=>{
   state.frame=null;const visible=[...state.entries].filter(row=>row.card.isConnected&&(row.card.classList.contains('material-detail-open')||row.host.querySelector('.material-local-comment,.material-highlight-draft')));
   if(!visible.length){lane.hidden=true;return;}lane.hidden=false;
   const bounds=canvas.getBoundingClientRect(),paper=visible[0].card.closest('.paper');if(!paper)return;
   let bottom=0;
   for(const row of visible.sort((a,b)=>a.card.getBoundingClientRect().top-b.card.getBoundingClientRect().top)){
    const page=row.card.closest('.paper');if(!page)continue;
    const draft=row.host.querySelector('.material-highlight-draft'),cardBounds=row.card.getBoundingClientRect();
    if(draft){const selection=win.getSelection();if(selection?.rangeCount&&row.card.contains(selection.anchorNode)){const selected=selection.getRangeAt(0).getBoundingClientRect();if(selected.height)row.draftOffset=selected.top-cardBounds.top;}}
    else delete row.draftOffset;
    const anchor=row.card.querySelector('.material-inline-source mark[data-preview],.material-inline-source mark,.material-annotated-excerpts:not([hidden]) mark')||row.card.querySelector('.material-inline-source')||row.card;
    const position=anchor.getBoundingClientRect(),pageBounds=page.getBoundingClientRect(),anchorTop=draft&&row.draftOffset!=null?cardBounds.top+row.draftOffset:position.top,top=Math.max(anchorTop-bounds.top+canvas.scrollTop,bottom);
    const geometry=materialMarginGeometry({innerWidth:canvas.clientWidth,pageRight:pageBounds.right-bounds.left});
    row.host.style.left=geometry.left+canvas.scrollLeft+'px';row.host.style.width=geometry.railWidth+'px';row.host.style.maxHeight='';
    if(!geometry.compact||draft){row.expanded=false;row.revealMark=null;}row.host.dataset.compact=String(geometry.compact);row.host.dataset.drafting=String(!!draft);syncToggle(row);
    let placedTop=top;
    // A narrow canvas clamps the card to its right edge. Put a draft (or a
    // comment opened from its highlight) below or above the words it would
    // cover, and keep it above the collapsed conversation bar.
    const avoid=draft?[...row.card.querySelectorAll('mark[data-preview]')]:row.expanded&&row.revealMark?.isConnected?[row.revealMark]:[];
    {const preview=avoid.map(mark=>mark.getBoundingClientRect());if(preview.length){
     const selected={left:Math.min(...preview.map(r=>r.left)),right:Math.max(...preview.map(r=>r.right)),top:Math.min(...preview.map(r=>r.top)),bottom:Math.max(...preview.map(r=>r.bottom))},left=bounds.left+geometry.left,reveal=doc.querySelector('.clui-native-reveal'),limit=Math.min(bounds.top+canvas.clientHeight,reveal&&!reveal.hidden&&reveal.getClientRects().length?reveal.getBoundingClientRect().top:Infinity);
     if(left<selected.right&&left+geometry.railWidth>selected.left){const below=Math.max(0,limit-selected.bottom-16),above=Math.max(0,selected.top-bounds.top-16),height=row.host.getBoundingClientRect().height;
      if(below>=height||below>=above){placedTop=Math.max(bottom,selected.bottom-bounds.top+canvas.scrollTop+8);if(below>0)row.host.style.maxHeight=below+'px';}
      else{row.host.style.maxHeight=above+'px';placedTop=Math.max(bottom,selected.top-bounds.top+canvas.scrollTop-8-Math.min(height,above));}
     }
    }}
    row.host.style.top=placedTop+'px';bottom=placedTop+row.host.getBoundingClientRect().height+10;
   }
  };
  state.schedule=()=>{if(state.frame===null)state.frame=win.requestAnimationFrame(layout);};
  state.observer=new win.ResizeObserver(state.schedule);state.observer.observe(canvas);state.observer.observe(lane);canvas.addEventListener('scroll',state.schedule,{passive:true});win.addEventListener('resize',state.schedule);
  // An opened compact comment is a temporary overlay: any press outside its
  // material, or Escape, returns it to the badge.
  const collapse=row=>{row.expanded=false;row.revealMark=null;syncToggle(row);state.schedule();};
  state.outside=event=>{for(const row of state.entries)if(row.expanded&&!row.host.contains(event.target)&&!row.card.contains(event.target))collapse(row);};
  state.escape=event=>{if(event.key!=='Escape')return;const open=[...state.entries].filter(row=>row.expanded);if(!open.length)return;event.preventDefault();event.stopPropagation();for(const row of open){collapse(row);if(row.host.contains(doc.activeElement))row.toggle?.focus({preventScroll:true});}};
  doc.addEventListener('pointerdown',state.outside,true);doc.addEventListener('keydown',state.escape);
  state.dispose=()=>{if(state.frame!==null)win.cancelAnimationFrame(state.frame);state.observer.disconnect();canvas.removeEventListener('scroll',state.schedule);win.removeEventListener('resize',state.schedule);doc.removeEventListener('pointerdown',state.outside,true);doc.removeEventListener('keydown',state.escape);lane.remove();rails.delete(canvas);};
 }
 const host=doc.createElement('section');host.className='material-margin-group';host.dataset.materialMarginFor=card.dataset.materialId;state.lane.append(host);
 // The count badge is made on first use (syncToggle). A render inserts a host
 // for each of its ~300 cards, and most of them never show a badge.
 const entry={card,host,toggle:null,expanded:false,revealMark:null,schedule:state.schedule};
 // material-highlights.mjs announces a click on a saved highlight. In compact
 // mode open its comment beside that highlight instead of scrolling the paper.
 const reveal=event=>{if(entry.host.dataset.compact!=='true'||entry.host.dataset.drafting==='true')return;entry.expanded=true;entry.revealMark=event.target?.closest?.('mark')||null;syncToggle(entry);state.schedule();event.preventDefault();};
 card.addEventListener('material-highlight-reveal',reveal);
 state.entries.add(entry);state.observer.observe(card);state.observer.observe(host);state.schedule();
 return {host,schedule:state.schedule,dispose(){card.removeEventListener('material-highlight-reveal',reveal);state.observer.unobserve(card);state.observer.unobserve(host);state.entries.delete(entry);host.remove();if(!state.entries.size)state.dispose();else state.schedule();}};
}
function syncToggle(row){
 const count=row.host.querySelectorAll('.material-local-comment').length,show=row.host.dataset.compact==='true'&&row.host.dataset.drafting!=='true'&&count>0;
 if(!count)row.expanded=false;row.host.dataset.expanded=String(!!row.expanded);
 if(!row.toggle){if(!show)return;const toggle=row.host.ownerDocument.createElement('button');toggle.type='button';toggle.className='material-margin-toggle';toggle.onclick=event=>{event.stopPropagation();row.expanded=!row.expanded;row.revealMark=null;syncToggle(row);row.schedule();};row.toggle=toggle;row.host.prepend(toggle);}
 row.toggle.hidden=!show;
 const label=materialMarginToggleLabel(count,row.expanded);if(row.toggle.textContent!==label)row.toggle.textContent=label;row.toggle.title=row.expanded?'收起页外批注':'显示页外批注';row.toggle.setAttribute('aria-expanded',String(!!row.expanded));
}
