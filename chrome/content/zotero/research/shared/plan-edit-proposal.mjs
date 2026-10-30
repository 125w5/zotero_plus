/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {editablePlanFields,planField} from './academic-plan-edit.mjs';

const jobs=new Map();
const clone=value=>JSON.parse(JSON.stringify(value));
export function pendingPlanEditMessage(messages=[]){const message=messages.at(-1);return message?.role==='assistant'&&['pending','saved'].includes(message.planEditProposal?.status)?message:null;}
export function assertPlanEditProposal(notebook,proposal){
 if(!proposal||proposal.kind!=='research-plan-edit'||typeof proposal.id!=='string'||!proposal.id||typeof proposal.projectID!=='string'||!proposal.projectID||!notebook.project(proposal.projectID))throw Error('方案候选没有对应的研究项目');
 const state=notebook.state(proposal.projectID),version=state.versions.find(row=>row.id===proposal.versionID);
 if(!version||typeof proposal.before!=='string'||planField(version.plan,proposal.path)!==proposal.before)throw Error('原方案或字段已变化，请重新生成候选');
 const {selectedStart:start,selectedEnd:end,selectedBefore:before,selectedAfter:after}=proposal;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>proposal.before.length||proposal.before.slice(start,end)!==before||typeof after!=='string'||!after.trim()||proposal.value!==proposal.before.slice(0,start)+after+proposal.before.slice(end))throw Error('方案候选选区或替换文字不完整');
 return {state,version,field:editablePlanFields(version.plan).find(row=>row.path===proposal.path)};
}
// UI copies in different surfaces share a candidate ID. The saved version also
// records it, so a failed transcript save or a second click cannot create a
// second research plan. Assembly adoption is separately retryable.
export function applyPlanEditProposal(notebook,proposal,{beforeApply=async()=>{},onChange=async()=>{},onApplied=async()=>{}}={}){
 const key=proposal.projectID+'|'+proposal.id;if(jobs.has(key))return jobs.get(key);
 const task=(async()=>{
  assertPlanEditProposal(notebook,proposal);if(proposal.status==='rejected')throw Error('已保留原方案，请重新提出修改');
  await beforeApply();let state=notebook.state(proposal.projectID),saved=state.versions.find(row=>row.edit?.proposalID===proposal.id);
  if(saved&&(saved.editedFrom!==proposal.versionID||saved.edit?.path!==proposal.path||saved.edit?.before!==proposal.before||saved.edit?.after!==proposal.value))throw Error('候选编号与已保存修改不一致');
  if(!saved){if(state.selectedVersion!==proposal.versionID)throw Error('当前已切换方案，请重新生成候选');assertPlanEditProposal(notebook,proposal);saved=await notebook.editPlanField(proposal.projectID,{versionID:proposal.versionID,path:proposal.path,before:proposal.before,value:proposal.value,proposalID:proposal.id});}
  proposal.status='saved';proposal.acceptedVersionID=saved.id;proposal.acceptedVersionNumber=saved.number;delete proposal.adoptionError;await onChange(clone(proposal));
  try{
   state=notebook.state(proposal.projectID);if(state.selectedVersion!==saved.id)throw Error('当前已切换到另一方案，未替换装配依据');
   if(typeof notebook.adoptPlanForAssembly!=='function')throw Error('装配方案同步接口尚未加载，请重启新版后重试');
   const result=await notebook.adoptPlanForAssembly(proposal.projectID,saved.id);
   proposal.status='accepted';proposal.assemblyAdopted=result.adopted===true;await onChange(clone(proposal));await onApplied(saved,result);return {version:saved,...result};
  }catch(error){proposal.status='saved';proposal.adoptionError=error.message;await onChange(clone(proposal));throw Error('新方案已保存，装配依据尚未同步：'+error.message);}
 })();jobs.set(key,task);task.finally(()=>{if(jobs.get(key)===task)jobs.delete(key);}).catch(()=>{});return task;
}

export function renderPlanEditProposal(host,proposal,{notebook,onChange,beforeApply,onApplied,onError=()=>{}}={}){
 if(!proposal)return null;const doc=host.ownerDocument,create=(tag,cls,text)=>{const el=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
 if(!doc.querySelector('[data-plan-edit-proposal-style]')){const link=create('link');link.rel='stylesheet';link.href='chrome://zotero/content/research/shared/plan-edit-proposal.css';link.dataset.planEditProposalStyle='true';(doc.head||doc.documentElement).append(link);}
 const root=create('section','plan-edit-proposal');root.dataset.proposalId=proposal.id;root.setAttribute('aria-label','研究方案修改候选');host.append(root);let busy=false;
 const render=()=>{
  root.replaceChildren();let current,problem='';try{current=assertPlanEditProposal(notebook,proposal);if(proposal.status==='pending'&&current.state.selectedVersion!==proposal.versionID)problem='当前方案已变化，请重新生成候选';}catch(error){problem=error.message;}
  const title=create('header','plan-edit-proposal-heading');title.append(create('strong','',current?.field?.label||'方案修改'),create('span','plan-edit-proposal-version','第 '+(current?.version?.number||'—')+' 版'));root.append(title);
  const diff=create('div','plan-edit-proposal-diff');diff.append(create('del','',proposal.selectedBefore||'（空）'),create('ins','',proposal.selectedAfter||''));root.append(diff);
  const accepted=proposal.status==='accepted',rejected=proposal.status==='rejected',saved=proposal.status==='saved';
  const status=create('p','plan-edit-proposal-status');
  status.textContent=busy?'正在保存修改…':problem|| (accepted?'已保存第 '+proposal.acceptedVersionNumber+' 版'+(proposal.assemblyAdopted?'，装配依据已同步':''):rejected?'已保留原方案':saved?'第 '+proposal.acceptedVersionNumber+' 版已保存，装配依据待同步':'采用后保存新版本');if(proposal.adoptionError&&!busy)status.textContent+=' · '+proposal.adoptionError;status.setAttribute('role','status');root.append(status);
  if(accepted||rejected)return;const actions=create('div','plan-edit-proposal-actions'),accept=create('button','plan-edit-proposal-accept',saved?'重试同步装配依据':'采用修改');accept.type='button';accept.disabled=busy||!!problem;actions.append(accept);
  accept.onclick=async()=>{if(busy)return;busy=true;render();try{await applyPlanEditProposal(notebook,proposal,{beforeApply,onChange,onApplied});}catch(error){onError(error);}finally{busy=false;render();}};
  if(!saved){const keep=create('button','plan-edit-proposal-keep','保留原方案');keep.type='button';keep.disabled=busy;keep.onclick=async()=>{if(busy)return;proposal.status='rejected';busy=true;render();try{await onChange?.(clone(proposal));}catch(error){proposal.status='pending';onError(error);}finally{busy=false;render();}};actions.append(keep);}root.append(actions);
 };render();return root;
}
