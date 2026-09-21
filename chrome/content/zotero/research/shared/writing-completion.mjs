/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {id,clone,validateProposal} from './manuscript-model.mjs';
import {protectEdit} from './writing-protection.mjs';

export function completionProposal(p,b,value,range){
 const text=value?.text?.trim();
 if(!text||text.length<15||text.length>16000||!/[\u3400-\u9fff]/.test(text))throw Error('模型未返回可用的中文正文，请重试');
 if(/^(?:已生成|以下是(?:写作)?(?:步骤|计划)|我将|我会|你可以)/.test(text))throw Error('模型返回了操作说明，未返回正文，请重试');
 const part=b.text.slice(range.start,range.end),fragment={...b,text:part};let d;
 if(value.evidence?.length)d=validateProposal(p,fragment,{text,evidence:value.evidence});
 else{
  if(!['background','method_explanation','plan'].includes(value.contentKind))throw Error('结果结论缺少来源，无法写入；可改写背景、方法说明或实验计划');
  if(/(?:实验|结果|数据|测试).{0,8}(?:表明|证明|显示|达到|提升了)|显著(?:提升|优于|降低)|我们(?:发现|验证了|实现了)|已(?:完成|验证|开展)/.test(text))throw Error('缺少实验来源，不能写成已经完成的结果');
  if(value.contentKind==='plan'&&!/拟|计划|将|后续|有待/.test(text))throw Error('未完成的实验必须明确写为计划');
  const known=new Set((b.text+' '+b.requirements+' '+(range.goal||'')).match(/[-+]?\d+(?:\.\d+)?%?/g)||[]);
  if((text.match(/[-+]?\d+(?:\.\d+)?%?/g)||[]).some(n=>!known.has(n)))throw Error('未找到新增数字的真实来源');
  d={id:id('completion'),blockID:b.id,before:part,after:text,evidence:[],materialRevisions:[],status:'pending',at:new Date().toISOString(),preserveClaim:true,originalClaim:false};
 }
 const after=b.text.slice(0,range.start)+text+b.text.slice(range.end);protectEdit(b.text,after);
 return {...d,before:b.text,after,insertText:text,selection:{start:range.start,end:range.end},baseRevision:b.revision,contentKind:value.contentKind||'sourced',range:clone(range),unverified:!value.evidence?.length};
}
