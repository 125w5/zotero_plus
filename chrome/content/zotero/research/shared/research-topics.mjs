/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {normalize,TYPES,catalogFor} from './material-catalog.mjs';
export function validateTopics(value,materials,catalog){
 const ids=new Set(materials.map(m=>m.id)),used=new Map(),groups=[];
 for(const raw of (value?.topics||[]).slice(0,8)){
  const name=String(raw.name||'').trim(),description=String(raw.description||'').trim();
  if(!name||name.length>36||TYPES.includes(name)||!/[\u3400-\u9fff]/.test(name)||!description)continue;
  const key=normalize(name),prior=catalog.topics.find(t=>normalize(t.name)===key||t.aliases?.some(a=>normalize(a)===key));
  const members=[...new Set(raw.materialIDs||[])].filter(id=>ids.has(id)&&(used.get(id)||0)<3);if(!members.length)continue;
  const duplicate=groups.find(g=>normalize(g.name)===key);if(duplicate){duplicate.materialIDs=[...new Set([...duplicate.materialIDs,...members])];continue;}
  for(const id of members)used.set(id,(used.get(id)||0)+1);
  groups.push({id:prior?.id||'research-topic-'+encodeURIComponent(key),name:prior?.name||name,description,materialIDs:members});
 }
 if(!groups.length)throw Error('未得到有来源素材的研究主题，请补充主题说明后重试');return groups;
}
export function applyTopics(p,materials,groups){
 const c=catalogFor(p,materials);let linked=0;
 for(const group of groups){if(!c.topics.some(t=>t.id===group.id))c.topics.push({id:group.id,name:group.name,description:group.description,kind:'research',parentID:p.id});
  for(const id of group.materialIDs){const entry=c.entries[id];if(!entry||entry.topics.includes(group.id))continue;entry.topics.push(group.id);linked++;}
 }return linked;
}
export function topicCards(p,materials){const c=catalogFor(p,materials);return c.topics.map(t=>({...t,count:materials.filter(m=>c.entries[m.id].topics.includes(t.id)).length}));}
