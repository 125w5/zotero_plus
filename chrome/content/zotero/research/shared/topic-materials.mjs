import {material,clone} from './manuscript-model.mjs';
import {hasChinese} from './material-language.mjs';
export function topicCards(value,sources,topic){
 if(!Array.isArray(value?.cards)||value.cards.length>30)throw Error('素材建议格式无效（最多 30 张）');
 return value.cards.map(c=>{if(typeof c.title!=='string'||typeof c.summary!=='string'||!c.summary.trim())throw Error('素材标题或概括为空');
  if(!hasChinese(c.summary))throw Error('素材简要说明必须使用简体中文，专有名词可以保留');
  if(c.kind==='idea')return material({kind:'idea',title:c.title,summary:c.summary,sourceText:'',category:c.category||'研究构想',verification:'unverified',topic,anchor:{},history:[],aiGenerated:true});
  const s=sources.find(s=>s.id===c.sourceID);if(!s||typeof c.quote!=='string'||!c.quote.trim()||!s.sourceText.includes(c.quote))throw Error('证据素材的原文摘录不匹配，已拒绝入库');
  const numeric=String(c.summary).match(/[-+]?\d+(?:\.\d+)?%?/g)||[],known=new Set(c.quote.match(/[-+]?\d+(?:\.\d+)?%?/g)||[]);if(numeric.some(n=>!known.has(n)))throw Error('素材概括含来源摘录没有的数字');
  return material({...clone(s),kind:s.kind,sourceText:c.quote,fullSourceText:s.sourceText,title:c.title,summary:c.summary,category:c.category||'研究背景',verification:'unverified',topic,history:[],aiGenerated:true,anchor:{...s.anchor,sourceText:c.quote},sourceVersion:s.sourceVersion||s.revision||1});
 });
}
