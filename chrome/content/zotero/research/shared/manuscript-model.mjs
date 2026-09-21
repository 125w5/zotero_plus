import {sourceQuote} from './source-quote.mjs';
/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {protectEdit} from './writing-protection.mjs';
export const id = prefix => prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
export const clone = value => JSON.parse(JSON.stringify(value));
export const WRITING_TEMPLATES = [
 {id:'imrad',name:'实证论文 IMRaD',sections:['引言','方法','结果','讨论','结论']},
 {id:'method',name:'方法与算法',sections:['研究问题','相关工作','方法','实验设置','结果与消融','局限与结论']},
 {id:'review',name:'文献综述',sections:['范围与问题','检索策略','主题综述','比较与争议','研究空白','结论']}
];
/** @typedef {{id:string, paperItemID:number|null, attachmentID:number|null, pageIndex:number|null, position:object|null, sourceText:string, citationItemID:number|null, dataCell:object|null}} EvidenceAnchor */
/** @typedef {{id:string,kind:string,title:string,anchor:EvidenceAnchor,revision:number,sourceText:string,data:object|null}} ResearchMaterial */
/** @typedef {{id:string,type:string,text:string,sectionID:string,materials:Array,review:string,table?:object}} AssemblyBlock */
/** @typedef {{id:string,name:string,sections:string[],referenceDoc:string|null}} WritingTemplate */
/** @typedef {{schemaVersion:number,id:string,title:string,sections:Array,materials:Array,blocks:AssemblyBlock[],ui:object,chat:Array,revision:number}} ManuscriptProject */
export function createProject(title,templateID='imrad') {
 const t=WRITING_TEMPLATES.find(t=>t.id===templateID)||WRITING_TEMPLATES[0];
 const sections=t.sections.map(title=>({id:id('section'),title,conclusion:''}));
 return {schemaVersion:1,id:id('manuscript'),title:title.trim()||'未命名论文',template:{...clone(t),referenceDoc:null},sections,materials:[],blocks:[],chat:[],proposals:[],revision:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),ui:{step:0,left:'materials',leftOpen:true,rightOpen:true,aiOpen:false,sectionID:sections[0].id,blockID:null,scrollTop:0,caret:0,leftWidth:310,rightWidth:320,aiHeight:220},citationStyle:'http://www.zotero.org/styles/apa',language:'zh-CN'};
}
export function assertProject(p){
 if(p?.schemaVersion!==1||typeof p.id!=='string'||typeof p.title!=='string'||!p.title.trim())throw Error('论文项目结构或版本无效');
 for(const key of ['sections','materials','blocks','chat','proposals'])if(!Array.isArray(p[key]))throw Error('论文项目缺少 '+key);
 for(const key of ['sections','materials','blocks']){const ids=p[key].map(x=>x.id);if(ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)throw Error('项目存在重复或无效的标识');}
 if(p.blocks.some(b=>!p.sections.some(s=>s.id===b.sectionID)||!Array.isArray(b.materials)))throw Error('模块与章节关系无效');
 for(const m of p.materials)if(!m.anchor||typeof m.sourceText!=='string'||!Number.isInteger(m.revision))throw Error('素材缺少来源锚点或版本');
 for(const b of p.blocks)if(b.type==='table'){
  const t=b.table;if(!t?.rows?.length||!t.widths?.length||t.heights.length!==t.rows.length||t.rows.some(r=>r.length!==t.widths.length))throw Error('表格行列或尺寸不完整');
  t.rows.forEach((r,ri)=>r.forEach((c,ci)=>{if(!c.hidden&&(!Number.isInteger(c.rowspan)||!Number.isInteger(c.colspan)||c.rowspan<1||c.colspan<1||ri+c.rowspan>t.rows.length||ci+c.colspan>t.widths.length))throw Error('表格合并范围无效');}));
 }
 return p;
}
export function material(input){
 const anchor={paperItemID:null,attachmentID:null,pageIndex:null,position:null,sourceText:'',citationItemID:null,dataCell:null,...input.anchor};
 return {id:id('material'),kind:'experiment',title:'素材',revision:1,sourceText:anchor.sourceText,data:null,...input,anchor,...Object.fromEntries(['paperItemID','attachmentID','pageIndex','position','citationItemID'].map(k=>[k,anchor[k]]))};
}
export function block(type,sectionID,extra={}){return {id:id('block'),type,sectionID,text:'',materials:[],role:'support',targetWords:300,requirements:'',review:'missing',claim:false,revision:1,...extra};}
export function makeTable(rows,cols){
 if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||cols<1||rows>100||cols>30)throw Error('表格支持 1–100 行、1–30 列');
 return {rows:Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>({text:r===0?'列 '+(c+1):'',rowspan:1,colspan:1,align:'auto',vertical:'center'}))),width:158,widths:Array(cols).fill(158/cols),heights:Array(rows).fill(9),style:'grid',border:1,color:'000000',padding:1.8,caption:'',binding:null};
}
export function bindTable(p,b,m){if(!m.data?.rows?.length)throw Error('素材没有表格数据');const rows=m.data.rows;b.table=makeTable(rows.length,rows[0].length);b.table.rows=rows.map(row=>row.map(text=>({text:String(text??''),rowspan:1,colspan:1,align:'auto',vertical:'center'})));b.table.binding={materialID:m.id,revision:m.revision};b.materials=[{id:m.id,role:'primary',revision:m.revision}];b.review='missing';}
export function invalidate(p,materialID){const affected=new Set(p.blocks.filter(b=>b.materials.some(m=>m.id===materialID)||b.table?.binding?.materialID===materialID).map(b=>b.id));let more=true;while(more){more=false;for(const b of p.blocks)if(!affected.has(b.id)&&b.dependsOn?.some(id=>affected.has(id))){affected.add(b.id);more=true;}}for(const b of p.blocks)if(affected.has(b.id))b.review='stale';}
export function updateMaterial(p,materialID,change){const m=p.materials.find(m=>m.id===materialID);if(!m)throw Error('素材不存在');Object.assign(m,change);if(change.sourceText!==undefined)m.anchor.sourceText=change.sourceText;m.revision++;invalidate(p,materialID);}
export function validate(p){const issues=[];const push=(b,message,severity='error')=>issues.push({blockID:b?.id,message,severity});if(!p.blocks.some(b=>b.text?.trim()||['table','image'].includes(b.type)))push(null,'论文尚未装配内容');for(const b of p.blocks){
 if(b.emptyStarter&&!b.text?.trim()&&!b.materials.length)continue;
 if(b.type==='placeholder'||(!b.text?.trim()&&!['table','image','citation'].includes(b.type)))push(b,'有待填写的内容');
 if(b.claim&&!b.materials.length)push(b,'论点缺少来源');
 if(['stale','conflict'].includes(b.review))push(b,'来源或数据已变化，需要重新核验');
 if(b.materials.some(x=>!p.materials.some(m=>m.id===x.id)))push(b,'关联素材不存在');
 if(b.type==='citation'&&!b.citationItemID)push(b,'无效引用');
 if(b.type==='image'&&!b.imagePath)push(b,'图片缺失');
 if(b.type==='table'&&b.table.rows.some(r=>r.some(c=>!c.hidden&&!c.text?.trim())))push(b,'表格有缺失数据');
 if(b.type==='formula'&&!b.text.trim())push(b,'公式为空');
 }return issues;}
export function validateProposal(p,b,value){
 if(typeof value.text!=='string'||!value.text.trim()||value.text.length>16000)throw Error('AI 返回的修改内容无效');
 if(b.locked)throw Error('此段已锁定');protectEdit(b.text,value.text);
 const allowed=b.materials.map(x=>p.materials.find(m=>m.id===x.id)).filter(Boolean), evidence=value.evidence;
 if(!Array.isArray(evidence)||!evidence.length)throw Error('AI 修改没有可核对来源，不能应用');
 for(const e of evidence){const m=allowed.find(m=>m.id===e.materialID);if(!m||m.kind==='idea'||m.verification==='stale'||!e.quote?.trim())throw Error('AI 引用未知或空素材');const source=e.cell?String(m.data?.rows?.[e.cell.row]?.[e.cell.col]??''):m.sourceText;const canonical=sourceQuote(source,e.quote);if(!canonical)throw Error('AI 摘录与素材不匹配');e.quote=canonical;}
 const numbers=value.text.match(/[-+]?\d+(?:\.\d+)?%?/g)||[],source=evidence.map(e=>{const m=allowed.find(m=>m.id===e.materialID);return e.cell?String(m.data.rows[e.cell.row][e.cell.col]):e.quote;}).join(' '),known=new Set(source.match(/[-+]?\d+(?:\.\d+)?%?/g)||[]);
 if(numbers.some(n=>!known.has(n)))throw Error('AI 添加了来源中没有的数字，已拒绝应用');
 return {id:id('diff'),blockID:b.id,before:b.text,after:value.text,evidence:clone(evidence),materialRevisions:allowed.map(m=>({id:m.id,revision:m.revision})),status:'pending',at:new Date().toISOString()};
}
export function applyProposal(p,d){const b=p.blocks.find(b=>b.id===d.blockID);if(!b||b.locked||b.text!==d.before||d.materialRevisions.some(r=>p.materials.find(m=>m.id===r.id)?.revision!==r.revision))throw Error('正文或素材已变化，请重新生成修改建议');if(d.status!=='pending')throw Error('该建议已经处理');protectEdit(d.before,d.after);b.text=d.after;if(b.runs?.length){const start=d.selection?.start||0,end=d.selection?.end??d.before.length,newText=d.after.slice(start,d.after.length-(d.before.length-end));let offset=0;const before=[],after=[];for(const r of b.runs){const next=offset+r.text.length;if(offset<start)before.push({...r,text:r.text.slice(0,Math.max(0,start-offset))});if(next>end)after.push({...r,text:r.text.slice(Math.max(0,end-offset))});offset=next;}b.runs=[...before,{text:newText},...after].filter(r=>r.text);}else delete b.runs;b.evidence=clone(d.evidence);b.claim=d.preserveClaim?d.originalClaim:true;b.review='missing';b.revision++;d.status='applied';}
