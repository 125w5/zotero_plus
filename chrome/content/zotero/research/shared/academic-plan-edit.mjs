/* SPDX-License-Identifier: AGPL-3.0-or-later */
const scalar=new Set(['title','novelty','significance','feasibility','minimumValidation']);
const nested={hypotheses:new Set(['claim','falsification']),experiments:new Set(['title','data','controls','comparison','metrics','support','refute','cost','outputs','preprocessing','leakage','baselines','ablations','robustness','reliability','failureAnalysis','reproducibility']),closest:new Set(['similarity','difference','counterevidence']),chapters:new Set(['task'])};
const labels={task:'本章任务',title:'方案标题',novelty:'创新点',significance:'研究价值',feasibility:'可行性',minimumValidation:'最小验证',claim:'假设',falsification:'否证条件',data:'数据',controls:'控制条件',comparison:'比较设计',metrics:'评价指标',support:'支持条件',refute:'反驳条件',cost:'资源与时间',outputs:'交付物',preprocessing:'预处理',leakage:'防泄漏',baselines:'基线',ablations:'消融',robustness:'鲁棒性',reliability:'可靠性',failureAnalysis:'失败分析',reproducibility:'复现条件',similarity:'相同之处',difference:'差异',counterevidence:'相反证据'};
export function researchPlanEditIntent(prompt){const text=String(prompt||'').trim();if(/(?:不要|不用|不必|禁止|别|无需).{0,8}(?:修改|改写|重写|调整|润色|精简)|(?:如何|怎么|怎样).{0,8}(?:修改|改写|重写|调整)|(?:do not|don't|how (?:do|to))\b/iu.test(text))return false;return /(?:修改|改写|重写|调整|润色|精简|改成|改为)[\s\S]{0,80}(?:方案|可行性|创新点|最小验证|研究价值)|(?:方案|可行性|创新点|最小验证|研究价值)[\s\S]{0,80}(?:修改|改写|重写|调整|润色|精简|改成|改为)|(?:revise|rewrite|edit|refine)\b[\s\S]{0,80}(?:research plan|feasibility|novelty|minimum validation)/iu.test(text);}
export function editablePlanFields(plan){const rows=[...scalar].map(path=>({path,label:labels[path],value:planField(plan,path)}));for(const [group,fields]of Object.entries(nested))for(const [index,row]of (Array.isArray(plan[group])?plan[group]:[]).entries())for(const field of fields){const path=group+'.'+index+'.'+field;rows.push({path,label:({hypotheses:'假设',experiments:'实验',closest:'已有工作',chapters:'章节'})[group]+' '+(index+1)+' · '+labels[field],value:planField(plan,path),...(row.id?{recordID:row.id}:{})});}for(const group of ['pending','openQuestions'])for(const [index,value]of (plan[group]||[]).entries())if(typeof value==='string')rows.push({path:group+'.'+index,label:(group==='pending'?'待补事项':'待讨论问题')+' '+(index+1),value});return rows;}
export function planField(plan,path){
 const keys=String(path).split('.');
 if(keys.length===1&&scalar.has(keys[0]))return String(plan[keys[0]]||'');
 if(keys.length===2&&['pending','openQuestions'].includes(keys[0])&&/^\d+$/.test(keys[1])&&typeof plan[keys[0]]?.[Number(keys[1])]==='string')return plan[keys[0]][Number(keys[1])];
 if(keys.length===3&&Object.hasOwn(nested,keys[0])&&nested[keys[0]].has(keys[2])&&/^\d+$/.test(keys[1])&&plan[keys[0]]?.[Number(keys[1])])return String(plan[keys[0]][Number(keys[1])][keys[2]]||'');
 throw Error('这项方案内容不可直接修改');
}
export function replacePlanField(plan,path,value){
 planField(plan,path);if(typeof value!=='string'||!value.trim()||value.length>20000)throw Error('方案文字不能为空或超过两万字');
 const next=JSON.parse(JSON.stringify(plan)),keys=String(path).split('.');let target=next;for(const key of keys.slice(0,-1))target=target[key];target[keys.at(-1)]=value.trim();return next;
}
export function planSelection(text,{selectedText,start,end}={}){
 if(!selectedText)return {start:0,end:text.length,text};
 if(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>start&&text.slice(start,end)===selectedText)return {start,end,text:selectedText};
 const index=text.indexOf(selectedText);if(index<0||text.indexOf(selectedText,index+1)>=0)throw Error('请在当前方案中重新选择要修改的文字');
 return {start:index,end:index+selectedText.length,text:selectedText};
}
