/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A narrow canvas scrolls horizontally instead of shrinking annotated text.
const rails=new WeakMap();
export function installMaterialMargin(card){
 const doc=card.ownerDocument,win=doc.defaultView,canvas=doc.getElementById('canvas');let state=rails.get(canvas);
 if(!doc.querySelector('link[data-material-overview]')){const link=doc.createElement('link');link.rel='stylesheet';link.href='chrome://zotero/content/research/manuscript/material-overview.css';link.dataset.materialOverview='true';doc.head.append(link);}
 if(!state){
  const lane=doc.createElement('div');lane.className='assembly-material-margin';lane.setAttribute('aria-label','素材页外批注');canvas.append(lane);
  state={lane,entries:new Set(),frame:null};rails.set(canvas,state);
  const layout=()=>{
   state.frame=null;const visible=[...state.entries].filter(row=>row.card.isConnected&&row.host.querySelector('.material-local-comment,.material-highlight-draft'));
   if(!visible.length){lane.hidden=true;canvas.classList.remove('material-margin-reserved');canvas.style.removeProperty('--margin-paper-width');return;}lane.hidden=false;
   const bounds=canvas.getBoundingClientRect(),paper=visible[0].card.closest('.paper');if(!paper)return;
   const style=win.getComputedStyle(canvas),padding=parseFloat(style.paddingLeft)||0,zoom=Number(paper.style.zoom)||1,innerWidth=canvas.clientWidth-padding-(parseFloat(style.paddingRight)||0);
   const width=Math.min(794,innerWidth),railWidth=180,gap=12,reserve=(innerWidth-width*zoom)/2<railWidth+gap;
   // Keep the reserved layout mounted during scrolling: removing it even for
   // one measurement would clamp scrollLeft before the paper is restored.
   if(reserve){canvas.style.setProperty('--margin-paper-width',width+'px');canvas.style.setProperty('--margin-paper-offset',(railWidth+gap)/zoom+'px');canvas.classList.add('material-margin-reserved');}
   else{canvas.classList.remove('material-margin-reserved');canvas.style.removeProperty('--margin-paper-width');}
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
  state.dispose=()=>{if(state.frame!==null)win.cancelAnimationFrame(state.frame);state.observer.disconnect();canvas.removeEventListener('scroll',state.schedule);win.removeEventListener('resize',state.schedule);lane.remove();canvas.classList.remove('material-margin-reserved');canvas.style.removeProperty('--margin-paper-width');canvas.style.removeProperty('--margin-paper-offset');rails.delete(canvas);};
 }
 const host=doc.createElement('section');host.className='material-margin-group';host.dataset.materialMarginFor=card.dataset.materialId;state.lane.append(host);const entry={card,host};state.entries.add(entry);state.observer.observe(card);state.observer.observe(host);state.schedule();
 return {host,schedule:state.schedule,dispose(){state.observer.unobserve(card);state.observer.unobserve(host);state.entries.delete(entry);host.remove();if(!state.entries.size)state.dispose();else state.schedule();}};
}
