/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Like the reader, annotations are a right-side overlay. Showing an annotation
// must never resize the paper or move the text that the user just selected.
const rails=new WeakMap();
export function materialMarginGeometry({innerWidth,pageRight=0,padding=8}){
 innerWidth=Math.max(1,Number(innerWidth)||1);padding=Math.min(padding,Math.max(0,(innerWidth-1)/2));
 const railWidth=Math.max(1,Math.min(innerWidth<620?196:228,innerWidth-padding*2)),gap=8;
 return {railWidth,gap,left:Math.max(padding,Math.min(pageRight+gap,innerWidth-railWidth-padding))};
}
export function installMaterialMargin(card){
 const doc=card.ownerDocument,win=doc.defaultView,canvas=doc.getElementById('canvas');let state=rails.get(canvas);
 if(!doc.querySelector('link[data-material-overview]')){const link=doc.createElement('link');link.rel='stylesheet';link.href='chrome://zotero/content/research/manuscript/material-overview.css';link.dataset.materialOverview='true';doc.head.append(link);}
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
    let placedTop=top;
    // A narrow canvas clamps the card to its right edge. Put a draft below (or
    // above) its preview highlight when that clamp would cover selected words.
    if(draft){const preview=[...row.card.querySelectorAll('mark[data-preview]')].map(mark=>mark.getBoundingClientRect());if(preview.length){
     const selected={left:Math.min(...preview.map(r=>r.left)),right:Math.max(...preview.map(r=>r.right)),top:Math.min(...preview.map(r=>r.top)),bottom:Math.max(...preview.map(r=>r.bottom))},left=bounds.left+geometry.left;
     if(left<selected.right&&left+geometry.railWidth>selected.left){const below=Math.max(0,bounds.top+canvas.clientHeight-selected.bottom-16),above=Math.max(0,selected.top-bounds.top-16),height=row.host.getBoundingClientRect().height;
      if(below>=height||below>=above){placedTop=Math.max(bottom,selected.bottom-bounds.top+canvas.scrollTop+8);if(below>0)row.host.style.maxHeight=below+'px';}
      else{row.host.style.maxHeight=above+'px';placedTop=Math.max(bottom,selected.top-bounds.top+canvas.scrollTop-8-Math.min(height,above));}
     }
    }}
    row.host.style.top=placedTop+'px';bottom=placedTop+row.host.getBoundingClientRect().height+10;
   }
  };
  state.schedule=()=>{if(state.frame===null)state.frame=win.requestAnimationFrame(layout);};
  state.observer=new win.ResizeObserver(state.schedule);state.observer.observe(canvas);state.observer.observe(lane);canvas.addEventListener('scroll',state.schedule,{passive:true});win.addEventListener('resize',state.schedule);
  state.dispose=()=>{if(state.frame!==null)win.cancelAnimationFrame(state.frame);state.observer.disconnect();canvas.removeEventListener('scroll',state.schedule);win.removeEventListener('resize',state.schedule);lane.remove();rails.delete(canvas);};
 }
 const host=doc.createElement('section');host.className='material-margin-group';host.dataset.materialMarginFor=card.dataset.materialId;state.lane.append(host);const entry={card,host};state.entries.add(entry);state.observer.observe(card);state.observer.observe(host);state.schedule();
 return {host,schedule:state.schedule,dispose(){state.observer.unobserve(card);state.observer.unobserve(host);state.entries.delete(entry);host.remove();if(!state.entries.size)state.dispose();else state.schedule();}};
}
