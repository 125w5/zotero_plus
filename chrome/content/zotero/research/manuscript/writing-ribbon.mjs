/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {findTextMatches,replaceTextMatches} from './manuscript-find.mjs';

function editableRange(node,start,end){
 const doc=node.ownerDocument,segments=[];let length=0;
 const segment=(text,left,right)=>{segments.push({text,start:length,end:length+text.length,left,right});length+=text.length;};
 const boundary=node=>[node.parentNode,[...node.parentNode.childNodes].indexOf(node)];
 // Match the saved run model's BR and block/list separators, including live
 // editor DOM that has not yet been normalized through a render.
 const visit=node=>{
  if(node.nodeType===3){segment(node.textContent,[node,0],[node,node.length]);return;}
  if(node.nodeType!==1)return;const tag=node.nodeName.toLowerCase(),point=boundary(node);
  if(tag==='br'){segment('\n',point,[point[0],point[1]+1]);return;}
  if(['div','p'].includes(tag)&&segments.length)segment('\n',point,point);
  for(const child of node.childNodes)visit(child);
 };
 if(['OL','UL'].includes(node.tagName)){for(const [index,item]of [...node.children].entries()){if(index){const point=boundary(item);segment('\n',point,point);}for(const child of item.childNodes)visit(child);}}
 else for(const child of node.childNodes)visit(child);
 const point=offset=>{for(const part of segments){if(offset<=part.end){if(part.left[0].nodeType===3)return [part.left[0],Math.max(0,offset-part.start)];return offset<=part.start?part.left:part.right;}}return null;};
 const left=point(start),right=point(end);if(!left||!right)return null;const range=doc.createRange();range.setStart(...left);range.setEnd(...right);return range;
}

export function installWritingRibbon(U,{el,button,snapshot,changed,persist,status,selectBlock}) {
 const doc=U.$('tools').ownerDocument,win=doc.defaultView,tools=U.$('tools');
 tools.classList.add('writing-ribbon');tools.dataset.ribbonTab='home';U.$('workspace').querySelector('main').prepend(tools);
 const link=el('link');link.rel='stylesheet';link.href=new URL('./writing-ribbon.css',import.meta.url).href;doc.head.append(link);
 const bar=el('div',undefined,'writing-ribbon-bar'),tabs=el('nav',undefined,'writing-ribbon-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','写作工具');
 const navigation=el('div',undefined,'writing-ribbon-navigation');bar.append(U.$('toggle-left'),navigation);tools.prepend(bar);
 for(const [id,title]of [['toggle-left','素材与结构栏'],['toggle-right','模块详情栏']]){U.$(id).setAttribute('aria-label','展开或收起'+title);U.$(id).title='展开或收起'+title;}
 const view=el('div',undefined,'writing-ribbon-view');navigation.append(view);bar.append(U.$('toggle-right'));
 const drawer=el('div',undefined,'writing-ribbon-drawer');drawer.id='writing-ribbon-drawer';drawer.hidden=true;drawer.append(tabs,U.$('manual-writing-tools'),U.$('insert-tools'));tools.append(drawer);
 const toggle=button('文字工具',()=>drawer.hidden?expand():collapse({force:true}),null,'writing-ribbon-toggle');toggle.dataset.action='toggle-writing-tools';toggle.setAttribute('aria-controls',drawer.id);toggle.setAttribute('aria-expanded','false');toggle.title='展开字体、段落、插入与查找工具';navigation.prepend(toggle);
 toggle.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14M10 4v12M6.5 16h7M3 4v3m14-3v3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>文字工具</span>';
 const pin=button('',()=>{U.p.ui.ribbonPinned=!U.p.ui.ribbonPinned;syncPin();persist();},null,'writing-ribbon-pin');bar.insertBefore(pin,U.$('toggle-right'));
 pin.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m15 3 6 6-3 1-3 6-3-3-7 7-1-1 7-7-3-3 6-3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
 function syncPin(){const pinned=!!U.p.ui.ribbonPinned;pin.setAttribute('aria-pressed',String(pinned));pin.title=pinned?'取消固定，点击外部自动收起':'固定工具栏';pin.setAttribute('aria-label',pin.title);tools.dataset.pinned=String(pinned);}
 const expand=()=>{drawer.hidden=false;pin.hidden=false;toggle.setAttribute('aria-expanded','true');tools.dataset.expanded='true';for(const tab of tabs.children)tab.setAttribute('aria-expanded',String(tab.getAttribute('aria-selected')==='true'));};
 const collapse=({force=false}={})=>{if(U.p.ui.ribbonPinned&&!force)return;drawer.hidden=true;pin.hidden=true;toggle.setAttribute('aria-expanded','false');tools.dataset.expanded='false';for(const tab of tabs.children)tab.setAttribute('aria-expanded','false');};
 const reset=()=>{U.p.ui.ribbonPinned=false;syncPin();collapse({force:true});};
 const syncView=()=>{const mode=U.$('canvas-display-mode');if(mode&&mode.parentElement!==view)view.append(mode);};
 // Both installation orders mount directly into this container. No subtree
 // observer is needed for every toolbar or editor DOM update.
 syncView();
 const input=(label,placeholder)=>{const node=el('input');node.type='text';node.setAttribute('aria-label',label);node.placeholder=placeholder;return node;};
 const finder=el('div',undefined,'writing-find-tools');finder.dataset.ribbonSurface='find';finder.hidden=true;
 const query=input('在论文正文中查找','查找正文、标题或列表'),replacement=input('替换为','替换为'),feedback=el('span',undefined,'writing-find-feedback');feedback.setAttribute('role','status');
 const field=el('div',undefined,'writing-find-fields');field.append(query,replacement);finder.append(field);U.$('insert-tools').append(finder);
 let matches=[],matchIndex=-1,lastQuery='';
 const recompute=()=>{matches=U.p.blocks.filter(block=>['paragraph','heading','list'].includes(block.type)).flatMap(block=>findTextMatches(block.text,query.value).map(match=>({...match,blockID:block.id})));if(query.value!==lastQuery)matchIndex=-1;lastQuery=query.value;feedback.textContent=query.value?(matches.length+' 处匹配'):'';return matches;};
 const editable=id=>U.$('canvas').querySelector('[data-id="'+id+'"] .editable');
 const selectMatch=match=>{
  const node=editable(match.blockID);if(!node)return false;selectBlock(match.blockID);node.focus({preventScroll:true});
  const range=editableRange(node,match.start,match.end);if(!range)return false;const selection=win.getSelection();selection.removeAllRanges();selection.addRange(range);node.scrollIntoView({block:'center'});feedback.textContent=(matchIndex+1)+' / '+matches.length;return true;
 };
 const find=(direction=1)=>{recompute();if(!matches.length){status(query.value?'正文中未找到该文字':'请输入查找内容');return;}matchIndex=matchIndex<0?(direction<0?matches.length-1:0):(matchIndex+direction+matches.length)%matches.length;selectMatch(matches[matchIndex]);};
 const apply=(all=false)=>{
  recompute();const targets=all?matches:matchIndex>=0&&matches[matchIndex]?[matches[matchIndex]]:matches.slice(0,1);if(!targets.length){find();return;}
  const groups=new Map();for(const match of targets){const block=U.p.blocks.find(block=>block.id===match.blockID);if(!block||block.locked)continue;if(!groups.has(block.id))groups.set(block.id,{block,matches:[]});groups.get(block.id).matches.push(match);}
  if(!groups.size){status('匹配内容已锁定，请先解锁');return;}
  const patches=[...groups.values()].map(({block,matches})=>({block,count:matches.length,patch:replaceTextMatches(block,matches,replacement.value)}));snapshot();
  for(const {block,patch}of patches){Object.assign(block,patch);block.revision++;if(block.claim)block.review='missing';}changed({editor:true});persist();matchIndex=-1;recompute();status('已替换 '+patches.reduce((count,row)=>count+row.count,0)+' 处 · Ctrl+Z 撤销');
 };
 const commands=el('div',undefined,'writing-find-actions');finder.append(commands,feedback);
 for(const [name,label,fn]of [['previous','上一处',()=>find(-1)],['next','下一处',()=>find()],['replace','替换此处',()=>apply()],['replaceAll','全部替换',()=>apply(true)]]){const control=button(label,fn,commands);control.dataset.writingFind=name;}
 query.addEventListener('input',recompute);query.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();find(event.shiftKey?-1:1);}});
 const setTab=(name,{focus=false,open=true}={})=>{tools.dataset.ribbonTab=name;for(const tab of tabs.querySelectorAll('button')){const active=tab.dataset.ribbonTab===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
  if(open)expand();
  U.$('manual-writing-tools').hidden=name!=='home';tools.querySelector('.manuscript-insert-actions').hidden=name!=='insert';finder.hidden=name!=='find';if(focus&&name==='find'){const selected=win.getSelection().toString();if(selected&&selected.length<150)query.value=selected;query.focus();recompute();}
 };
 for(const [name,label]of [['home','常用'],['insert','插入'],['find','查找与替换']]){const tab=button(label,()=>setTab(name,{focus:name==='find'}),tabs);tab.dataset.ribbonTab=name;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',drawer.id);tab.onmousedown=event=>event.preventDefault();}
 tabs.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const items=[...tabs.children],index=items.indexOf(doc.activeElement);event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;setTab(items[next].dataset.ribbonTab);items[next].focus();};
 const shortcut=event=>{if(!(event.ctrlKey||event.metaKey)||event.altKey||event.isComposing||!event.target.closest?.('#canvas,.writing-ribbon'))return;if(['f','h'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();setTab('find',{focus:true});if(event.key.toLowerCase()==='h')replacement.focus();}};
 const outside=event=>{if(!tools.contains(event.target))collapse();};
 const escape=event=>{if(event.key==='Escape'&&!drawer.hidden&&tools.contains(event.target)){collapse({force:true});event.preventDefault();event.stopPropagation();toggle.focus();}};
 const pinState=new win.MutationObserver(()=>{if(tools.dataset.pinned!==String(!!U.p.ui.ribbonPinned))syncPin();});pinState.observe(U.$('canvas'),{childList:true});
 doc.addEventListener('keydown',shortcut,true);doc.addEventListener('pointerdown',outside,true);tools.addEventListener('keydown',escape);syncPin();setTab('home',{open:!!U.p.ui.ribbonPinned});if(!U.p.ui.ribbonPinned)collapse();
 const api={root:tools,drawer,toggle,pin,view,setTab,expand,collapse,reset,query,replacement,find,replace:apply,refresh:recompute,destroy(){pinState.disconnect();doc.removeEventListener('keydown',shortcut,true);doc.removeEventListener('pointerdown',outside,true);tools.removeEventListener('keydown',escape);}};U.writingRibbon=api;
 win.addEventListener('pagehide',()=>api.destroy(),{once:true});return api;
}
