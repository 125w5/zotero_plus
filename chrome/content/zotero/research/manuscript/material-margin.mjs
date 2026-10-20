/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Comments occupy a separate rail. The paper and rail share the current
// canvas width; a comment never pushes authored text past the viewport.
const rails=new WeakMap();
export function materialMarginGeometry({innerWidth,zoom=1}){
 innerWidth=Math.max(1,Number(innerWidth)||1);zoom=Math.max(.1,Number(zoom)||1);
 const railWidth=Math.min(180,Math.max(72,innerWidth*.24),innerWidth*.32),gap=Math.min(12,Math.max(6,innerWidth*.025));
 const paperWidth=Math.max(1,Math.min(794,(innerWidth-railWidth-gap)/zoom)),spare=Math.max(0,innerWidth-railWidth-gap-paperWidth*zoom);
 return {railWidth,gap,paperWidth,paperOffset:(railWidth+gap+spare/2)/zoom,paperPadding:Math.min(40,Math.max(10,paperWidth*.065))};
}
export function installMaterialMargin(card){
 const doc=card.ownerDocument,win=doc.defaultView,canvas=doc.getElementById('canvas');let state=rails.get(canvas);
 if(!doc.querySelector('link[data-material-overview]')){const link=doc.createElement('link');link.rel='stylesheet';link.href='chrome://zotero/content/research/manuscript/material-overview.css';link.dataset.materialOverview='true';doc.head.append(link);}
 if(!state){
  const lane=doc.createElement('div');lane.className='assembly-material-margin';lane.setAttribute('aria-label','素材页外批注');canvas.append(lane);
  state={lane,entries:new Set(),frame:null};rails.set(canvas,state);
  const layout=()=>{
   state.frame=null;const visible=[...state.entries].filter(row=>row.card.isConnected&&(row.card.classList.contains('material-detail-open')||row.host.querySelector('.material-local-comment,.material-highlight-draft')));
   if(!visible.length){lane.hidden=true;canvas.classList.remove('material-margin-reserved');for(const key of ['--margin-paper-width','--margin-paper-offset','--margin-paper-padding'])canvas.style.removeProperty(key);return;}lane.hidden=false;
   const bounds=canvas.getBoundingClientRect(),paper=visible[0].card.closest('.paper');if(!paper)return;
   const style=win.getComputedStyle(canvas),padding=parseFloat(style.paddingLeft)||0,zoom=Number(paper.style.zoom)||1,innerWidth=canvas.clientWidth-padding-(parseFloat(style.paddingRight)||0);
   const {railWidth,gap,paperWidth,paperOffset,paperPadding}=materialMarginGeometry({innerWidth,zoom});
   canvas.style.setProperty('--margin-paper-width',paperWidth+'px');canvas.style.setProperty('--margin-paper-offset',paperOffset+'px');canvas.style.setProperty('--margin-paper-padding',paperPadding+'px');canvas.classList.add('material-margin-reserved');
   let bottom=0;
   for(const row of visible.sort((a,b)=>a.card.getBoundingClientRect().top-b.card.getBoundingClientRect().top)){
    const page=row.card.closest('.paper');if(!page)continue;
    const draft=row.host.querySelector('.material-highlight-draft'),cardBounds=row.card.getBoundingClientRect();
    if(draft){const selection=win.getSelection();if(selection?.rangeCount&&row.card.contains(selection.anchorNode)){const selected=selection.getRangeAt(0).getBoundingClientRect();if(selected.height)row.draftOffset=selected.top-cardBounds.top;}}
    else delete row.draftOffset;
    const anchor=row.card.querySelector('.material-inline-source mark,.material-annotated-excerpts:not([hidden]) mark')||row.card.querySelector('.material-inline-source')||row.card;
    const position=anchor.getBoundingClientRect(),pageBounds=page.getBoundingClientRect(),anchorTop=draft&&row.draftOffset!=null?cardBounds.top+row.draftOffset:position.top,top=Math.max(anchorTop-bounds.top+canvas.scrollTop,bottom);
    row.host.style.left=Math.max(padding,pageBounds.left-bounds.left+canvas.scrollLeft-railWidth-gap)+'px';row.host.style.top=top+'px';row.host.style.width=railWidth+'px';bottom=top+row.host.getBoundingClientRect().height+10;
   }
  };
  state.schedule=()=>{if(state.frame===null)state.frame=win.requestAnimationFrame(layout);};
  state.observer=new win.ResizeObserver(state.schedule);state.observer.observe(canvas);state.observer.observe(lane);canvas.addEventListener('scroll',state.schedule,{passive:true});win.addEventListener('resize',state.schedule);
  state.dispose=()=>{if(state.frame!==null)win.cancelAnimationFrame(state.frame);state.observer.disconnect();canvas.removeEventListener('scroll',state.schedule);win.removeEventListener('resize',state.schedule);lane.remove();canvas.classList.remove('material-margin-reserved');for(const key of ['--margin-paper-width','--margin-paper-offset','--margin-paper-padding'])canvas.style.removeProperty(key);rails.delete(canvas);};
 }
 const host=doc.createElement('section');host.className='material-margin-group';host.dataset.materialMarginFor=card.dataset.materialId;state.lane.append(host);const entry={card,host};state.entries.add(entry);state.observer.observe(card);state.observer.observe(host);state.schedule();
 return {host,schedule:state.schedule,dispose(){state.observer.unobserve(card);state.observer.unobserve(host);state.entries.delete(entry);host.remove();if(!state.entries.size)state.dispose();else state.schedule();}};
}
