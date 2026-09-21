/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const TYPES=['背景与问题','方法','数据集','实验设置','结果与对比','观点与结论','局限','图片','表格','公式','用户笔记','研究构想','待整理'];
export const TAGS=[
 {name:'卷积神经网络',aliases:['CNN','convolutional neural network'],parent:'神经网络'},
 {name:'域适应',aliases:['domain adaptation'],parent:'迁移学习'},
 {name:'域泛化',aliases:['domain generalization'],parent:'迁移学习'},
 {name:'调制识别',aliases:['modulation classification','modulation recognition','AMC'],parent:'无线通信'},
 {name:'少样本学习',aliases:['few-shot learning','few shot'],parent:'机器学习'}
];
export const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,' ').trim();
const list=value=>Array.isArray(value)?value.flatMap(list):value&&typeof value==='object'?value.label?[String(value.label)]:Object.values(value).flatMap(list):[String(value??'')];
export function canonicalTag(value,tags=TAGS){const v=normalize(value);return tags.find(t=>[t.name,...t.aliases].some(a=>normalize(a)===v))?.name||v;}
const typeAliases={background:'背景与问题',problem:'背景与问题',method:'方法',dataset:'数据集',experiment:'实验设置',result:'结果与对比',results:'结果与对比',claim:'观点与结论',conclusion:'观点与结论',limitation:'局限',limitations:'局限',figure:'图片',image:'图片',table:'表格',formula:'公式',note:'用户笔记',idea:'研究构想'};
export function materialType(m){const raw=m.primaryType||m.category;if(TYPES.includes(raw))return raw;const known={'研究问题':'背景与问题','背景':'背景与问题','问题':'背景与问题','研究背景':'背景与问题','领域':'背景与问题','论点':'观点与结论','贡献':'观点与结论','结论':'观点与结论','结果':'结果与对比','实验':'实验设置','实验结果':'结果与对比','局限性':'局限','研究局限':'局限','方法框架':'方法'};if(known[raw])return known[raw];if(typeAliases[normalize(raw)])return typeAliases[normalize(raw)];return ({note:'用户笔记',idea:'研究构想',experiment:'实验设置',image:'图片',table:'表格',formula:'公式'})[m.kind]||'待整理';}
// Classification is an overlay. Migration never rewrites source text or user edits.
export function catalogFor(p,materials){const c=p.materialCatalog||=( {version:1,topics:[{id:p.id,name:p.title}],entries:{},orders:{},aliases:[],collapsed:[]} );for(const m of materials)if(!c.entries[m.id])c.entries[m.id]={type:materialType(m),topics:[p.id],tags:[...new Set(list([m.tags,m.explicitTags,m.inferredTags,m.field,m.method]).filter(Boolean).map(t=>canonicalTag(t)))],inferred:true};return c;}
function contains(text,term){if(/^[a-z0-9]+$/i.test(term))return new RegExp('(^|[^a-z0-9])'+term+'(?=$|[^a-z0-9])','u').test(text);return text.includes(term);}
export function searchMaterials(materials,query,{summary=m=>m.summary||m.summaryZh||'',tags=TAGS}={}){
 const q=normalize(query);if(!q)return materials.map(m=>({m,score:0,reason:'',snippet:summary(m)}));
 const concepts=tags.filter(t=>[t.name,...t.aliases].some(a=>contains(q,normalize(a))));
 const words=q.match(/[\p{Script=Han}]+|[a-z0-9][a-z0-9+.-]*/gu)||[];
 const groups=words.map(w=>{const tag=tags.find(t=>[t.name,...t.aliases].some(a=>normalize(a)===w));return tag?[tag.name,...tag.aliases].map(normalize):[w];});
 for(const t of concepts)groups.push([t.name,...t.aliases].map(normalize));
 return materials.map(m=>{const fields=[['中文说明',summary(m)],['标题',m.title],['标签与别名',list([m.tags,m.explicitTags,m.inferredTags,m.field,m.method]).join(' ')],['原文或用户笔记',m.sourceText],['来源',list([m.coverage,m.author,m.doi,m.anchor?.url]).join(' ')]];
  let score=0,hit=null;for(const [name,value] of fields){const text=normalize(value);let n=contains(text,q)?12:0;for(const group of groups)if(group.some(w=>contains(text,w)))n+=4;else for(const w of group)if(/^[\p{Script=Han}]{3,}$/u.test(w)){const pairs=Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)),count=pairs.filter(s=>text.includes(s)).length;if(count>=2&&count/pairs.length>=0.6)n+=count/pairs.length;}if(n){score+=n;if(!hit||n>hit.n)hit={name,value:String(value||''),n};}}
  const display=hit?.value.normalize('NFKC').replace(/\s+/gu,' ')||'',folded=display.toLocaleLowerCase(),positions=[q,...groups.flat()].map(term=>folded.indexOf(term)).filter(i=>i>=0),index=Math.max(0,(positions.length?Math.min(...positions):0)-20);return {m,score,reason:hit?'命中'+hit.name+(concepts.length?' · 含规范别名':''):'',snippet:(index?'…':'')+display.slice(index,index+130)};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.m.id.localeCompare(b.m.id));
}
export function reorder(c,key,visibleIDs,movingIDs,targetID,after=false){const set=new Set(movingIDs),order=visibleIDs.filter(id=>!set.has(id));let i=order.indexOf(targetID);if(i<0)return;order.splice(i+Number(after),0,...visibleIDs.filter(id=>set.has(id)));const visible=new Set(visibleIDs),previous=c.orders[key]||[],remaining=[...order];c.orders[key]=previous.map(id=>visible.has(id)?remaining.shift():id).filter(Boolean).concat(remaining);}
export function removeFromTopic(c,ids,topic){for(const id of ids)if(c.entries[id])c.entries[id].topics=c.entries[id].topics.filter(x=>x!==topic);}
export function organizeSuggestions(materials,c){const changes=[];for(const m of materials){const e=c.entries[m.id],type=materialType(m),tags=[...new Set(e.tags.map(t=>canonicalTag(t)))];if((e.type==='待整理'&&type!=='待整理')||JSON.stringify(tags)!==JSON.stringify(e.tags))changes.push({id:m.id,title:m.title,before:structuredClone(e),after:{...e,type:e.type==='待整理'?type:e.type,tags}});}return changes;}
export function duplicateMaterials(materials){const groups=new Map();for(const m of materials){const source=m.attachmentID||m.anchor?.attachmentID||m.sourceItemID||m.anchor?.url;if(!source||!m.sourceText?.trim())continue;const key=JSON.stringify([source,m.pageIndex??m.anchor?.pageIndex,m.position??m.anchor?.position,normalize(m.sourceText)]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);}return [...groups.values()].filter(g=>g.length>1);}
export function mergeTags(c,names,target){
 const selected=new Set(names.map(normalize)),name=String(target).trim();if(!name||!selected.size)throw Error('请选择标签并填写规范名称');
 // Only an explicit user confirmation may merge different concepts.
 const existing=[...TAGS,...c.aliases].filter(t=>selected.has(normalize(t.name))||normalize(t.name)===normalize(name));
 const aliases=[...new Set([...names,...existing.flatMap(t=>[t.name,...t.aliases])])].filter(x=>normalize(x)!==normalize(name));
 c.aliases=c.aliases.filter(t=>!existing.some(e=>e.name===t.name));c.aliases.unshift({name,aliases,parent:existing.find(t=>t.parent)?.parent||''});
 let count=0;for(const entry of Object.values(c.entries)){if(entry.tags.some(t=>selected.has(normalize(t)))){entry.tags=[...new Set(entry.tags.map(t=>selected.has(normalize(t))?name:t))];count++;}}return count;
}
export function mergeTopics(c,source,target){if(source===target||!c.topics.some(t=>t.id===target))throw Error('目标主题无效');let count=0;for(const entry of Object.values(c.entries)){if(entry.topics.includes(source)){entry.topics=[...new Set(entry.topics.map(t=>t===source?target:t))];count++;}}const old=c.topics.find(t=>t.id===source),next=c.topics.find(t=>t.id===target);next.aliases=[...new Set([...(next.aliases||[]),old?.name,...(old?.aliases||[])].filter(Boolean))];c.topics=c.topics.filter(t=>t.id!==source);return count;}

// Shared query/filter/order semantics for compact and central views.
export function catalogResults(all,query,p,s,summary=m=>m.summary||''){
 const c=catalogFor(p,all),cards=all.filter(m=>(!s.topic||c.entries[m.id].topics.includes(s.topic))&&(!s.type||c.entries[m.id].type===s.type)&&(!s.categoryID||c.entries[m.id].categoryID===s.categoryID));
 let matches=searchMaterials(cards.map(m=>({...m,tags:[...c.entries[m.id].tags,...(Array.isArray(m.tags)?m.tags:[])]})),query,{summary,tags:[...c.aliases,...TAGS]}).map(hit=>({...hit,m:cards.find(m=>m.id===hit.m.id)}));
 if(s.filter)matches=matches.filter(({m})=>searchMaterials([{...m,summary:[summary(m),m.verification,m.year,m.date,c.entries[m.id].tags].join(' ')}],s.filter).length);
 matches=matches.filter(({m})=>Object.entries(s.facets||{}).every(([key,value])=>!value||(key==='verification'?(m.verification||'unverified')===value:searchMaterials([{id:m.id,title:'',summary:key==='year'?String(m.year||m.date||''):key==='source'?[m.coverage,m.anchor?.url,m.paperTitle,m.title].filter(Boolean).join(' '):[m[key],...c.entries[m.id].tags].filter(Boolean).join(' ')}],value,{tags:[...c.aliases,...TAGS]}).length)));
 const order=c.orders[(s.topic||'')+'|'+(s.type||'')+(s.categoryID?'|'+s.categoryID:'')]||[];if(s.sort==='manual'){const rank=id=>order.includes(id)?order.indexOf(id):order.length+cards.findIndex(x=>x.id===id);matches.sort((a,b)=>rank(a.m.id)-rank(b.m.id));}return matches;
}
