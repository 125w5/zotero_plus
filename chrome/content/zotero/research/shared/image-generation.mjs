/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {assertAIAction} from './research-ai-policy.mjs';

// The configured image provider exposes this OpenAI-compatible model name.
// GPT Image replies contain base64 bytes, never a durable download URL.
export const IMAGE_MODEL = 'gpt-image-2.5';

export function imageModelsFromCatalog(response) {
 const rows=Array.isArray(response?.data)?response.data:[];
 return [...new Set(rows.map(row=>row?.id).filter(id=>typeof id==='string'&&id.length<=160&&/(?:gpt-image|dall-e|imagen|flux|seedream|nano[-_ ]?banana)/i.test(id)))];
}

export function selectImageModel(models,configured='') {
 if(configured){if(models.length&&!models.includes(configured))throw Error('当前生图模型不在接口提供的模型列表中，请重新选择');return configured;}
 const selected=[IMAGE_MODEL,'gpt-image-1.5','gpt-image-1','gpt-image-1-mini','dall-e-3','dall-e-2'].find(id=>models.includes(id))||models[0];
 if(!selected)throw Error('接口没有列出生图模型，请在设置中填写该接口支持的生图模型');
 return selected;
}

export function imageRequest(prompt,{model=IMAGE_MODEL,size='1024x1024'}={}) {
 assertAIAction('image_generate');
 const text=String(prompt||'').trim();
 if(!text)throw Error('请描述要生成的图片');
 if(text.length>12000)throw Error('图片描述过长，请缩短到 12000 字以内');
 if(!['1024x1024','1536x1024','1024x1536'].includes(size))throw Error('请选择有效的图片尺寸');
 // GPT Image returns base64 by default and rejects response_format. DALL-E
 // needs this option so generated files are stored locally before URLs expire.
 return {model,prompt:text,n:1,size,...(/^dall-e-/i.test(model)?{response_format:'b64_json'}:{})};
}

export function generatedImageBytes(response) {
 const encoded=response?.data?.[0]?.b64_json;
 if(typeof encoded!=='string'||!encoded||encoded.length>20*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
  throw Error('生图接口没有返回有效的图片数据');
 let raw;
 try{raw=atob(encoded);}catch{throw Error('生图接口返回的图片编码无效');}
 if(raw.length>15*1024*1024)throw Error('生成图片超过 15 MB，请调整提示词重试');
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!png&&!jpeg&&!webp)throw Error('生图接口返回的内容不是可读取的图片');
 return {bytes,extension:png?'png':jpeg?'jpg':'webp'};
}
