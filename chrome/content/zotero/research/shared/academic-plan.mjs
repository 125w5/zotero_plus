/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const EXPERIMENT_FIELDS=['hypothesisID','data','controls','comparison','metrics','support','refute','cost','outputs','preprocessing','leakage','baselines','ablations','robustness','reliability','failureAnalysis','reproducibility'];
const text=v=>typeof v==='string'?v.trim():'';
export function validatePlan(value,sources){
 const plan=JSON.parse(JSON.stringify(value||{})),known=new Map(sources.map(s=>[s.id,s]));plan.pending=Array.isArray(plan.pending)?plan.pending.map(String):[];
 plan.hypotheses=Array.isArray(plan.hypotheses)?plan.hypotheses:[];
 if(!plan.hypotheses.length)throw Error('评估缺少可证伪假设，请重试。');
 const ids=new Set();for(const h of plan.hypotheses){if(!text(h.id)||ids.has(h.id)||!text(h.claim)||!text(h.falsification))throw Error('假设缺少稳定 ID、陈述或否定条件');ids.add(h.id);h.status='hypothesis';}
 plan.closest=Array.isArray(plan.closest)?plan.closest:[];
 for(const work of plan.closest){const s=known.get(work.sourceID);if(!s)throw Error('评估引用了未检索到的文献');const quote=text(work.quote),normalize=s=>String(s).replace(/\s+/g,' ').trim();if(!quote||!normalize(s.text).includes(normalize(quote)))throw Error('最接近文献的摘录未匹配原文');work.coverage=s.coverage;work.status='inference';}
 plan.experiments=Array.isArray(plan.experiments)?plan.experiments:[];if(!plan.experiments.length)throw Error('评估未返回实验方案');
 const experimentIDs=new Set();for(const e of plan.experiments){if(!text(e.id)||experimentIDs.has(e.id))throw Error('实验 ID 缺失或重复');experimentIDs.add(e.id);if(!ids.has(e.hypothesisID))throw Error('实验未绑定有效假设');e.status='planned';delete e.results;for(const key of EXPERIMENT_FIELDS)if(!text(e[key])){e[key]='待补';plan.pending.push(`${e.title||e.id}：${key} 待补`);}}
 for(const key of ['novelty','significance','feasibility','minimumValidation'])if(!text(plan[key])){plan[key]='待补';plan.pending.push(key+' 待补');}
 if(!plan.closest.length)plan.pending.push('未找到可比较的最接近工作；创新性尚未核实');
 delete plan.noveltyScore;delete plan.acceptanceProbability;plan.pending=[...new Set(plan.pending)];plan.status='proposal';return plan;
}
export function changedHypotheses(before,after){const old=new Map((before?.hypotheses||[]).map(h=>[h.id,h]));return [...new Set([...after.hypotheses.filter(h=>JSON.stringify(h)!==JSON.stringify(old.get(h.id))).map(h=>h.id),...(before?.hypotheses||[]).filter(h=>!after.hypotheses.some(x=>x.id===h.id)).map(h=>h.id)])];}
export function affectedExperiments(plan,ids){return plan.experiments.filter(e=>ids.includes(e.hypothesisID)).map(e=>e.id);}

// Model quote labels are temporary; bind generated prose to stable source IDs.
// Preserve verbatim quotes and the saved plan object.
export function bindPlanCitations(plan,sources){
 const visit=(value,key)=>{if(key==='quote')return value;if(typeof value==='string')return value.replace(/\[Q(\d+)\]/g,(token,n)=>sources[Number(n)-1]?'['+sources[Number(n)-1].id+']':'[待核验来源 '+token.slice(1,-1)+']');if(Array.isArray(value))return value.map(v=>visit(v));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v,k)]));return value;};return visit(plan);
}
