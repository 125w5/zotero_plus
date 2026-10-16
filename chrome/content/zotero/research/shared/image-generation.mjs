/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {assertAIAction} from './research-ai-policy.mjs';

// The configured image provider exposes this OpenAI-compatible model name.
// GPT Image replies contain base64 bytes, never a durable download URL.
export const IMAGE_MODEL = 'gpt-image-2.5';

export function imageRequest(){assertAIAction('image_generate');}

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
