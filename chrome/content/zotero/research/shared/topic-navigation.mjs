/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {topicCards} from './research-topics.mjs';
import {TYPES,catalogFor} from './material-catalog.mjs';
export function renderTopicNavigation(host,p,materials,state,{select,context,drop,typesInFilter=false,collapsible=false,toggle}={}){
 const d=host.ownerDocument,node=(tag,text)=>{const n=d.createElement(tag);if(text!==undefined)n.textContent=text;return n;};host.replaceChildren();host.className='topic-navigation';const topics=topicCards(p,materials),c=catalogFor(p,materials);
 const button=(title,fn,cls)=>{const b=node('button',title);b.type='button';b.className=cls||'';b.onclick=fn;host.append(b);return b;};
 const expanded=!collapsible||state.topicTreeOpen===true;
 const root=button('全部素材 · '+materials.length,()=>collapsible?toggle?.(!expanded,{all:!!state.topic}):select('', ''),!state.topic?'topic-current':'');
 root.dataset.topicRoot='true';
 if(collapsible){root.setAttribute('aria-expanded',String(expanded));root.setAttribute('aria-controls',host.id+'-branches');root.title=expanded?'收起研究主题':'展开研究主题';}
 const branches=collapsible?node('div'):host;if(collapsible){branches.className='topic-branches';branches.id=host.id+'-branches';branches.hidden=!expanded;host.append(branches);}
 const branchButton=(title,fn,cls)=>{const b=node('button',title);b.type='button';b.className=cls||'';b.onclick=fn;branches.append(b);return b;};
 const themed=topics.filter(t=>t.kind==='research'||t.id!==p.id),active=topics.find(t=>t.id===state.topic);

 for(const t of themed.filter(t=>!active||active.id===p.id||t.id===active.id)){const b=branchButton('',()=>select(t.id,''),'topic-tile'+(state.topic===t.id?' topic-current':''));b.dataset.topic=t.id;b.append(node('strong',t.name),node('small',t.count+' 张'+(t.description?' · '+t.description:'')));if(context)b.oncontextmenu=e=>context(e,t);if(drop){b.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-manuscript-material')){e.preventDefault();b.classList.add('drop-target');}};b.ondragleave=()=>b.classList.remove('drop-target');b.ondrop=e=>{e.preventDefault();b.classList.remove('drop-target');const id=e.dataTransfer.getData('application/x-manuscript-material');if(id)drop(id,t.id);};}}
 if(state.topic===p.id&&!themed.length)branches.append(node('small','当前项目 · '+p.title));
 if(active?.description){const text=node('p',active.description);text.className='topic-description';branches.append(text);}
 if(typesInFilter)return;
 const filters=node('details');filters.open=false;filters.className='topic-types';filters.append(node('summary',state.type?'类型：'+state.type:'按素材类型筛选'));
 const scoped=materials.filter(m=>!state.topic||c.entries[m.id].topics.includes(state.topic));for(const type of ['',...TYPES]){const count=scoped.filter(m=>!type||c.entries[m.id].type===type).length;if(!count)continue;const b=node('button',(type||'全部类型')+' '+count);b.type='button';b.className=state.type===type?'topic-current':'';b.onclick=()=>select(state.topic,type);filters.append(b);}branches.append(filters);
}
