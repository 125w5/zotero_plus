/* SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {XMLParser,XMLValidator} from 'fast-xml-parser';

// PDF text can contain TeX glyph codes in the XML 1.0 forbidden range.
// Preserve valid Unicode, tabs and line breaks; never copy those codes into OPC.
export function xml10Text(value){
 return String(value??'').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,'');
}
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const parser=new XMLParser({ignoreAttributes:false,processEntities:true});

export async function validatePresentationPackage(buffer){
 const zip=await JSZip.loadAsync(buffer,{checkCRC32:true}),files=new Set(Object.values(zip.files).filter(file=>!file.dir).map(file=>file.name));
 const warnings=[],cleanedParts=[],removedDeclarations=[];
 for(const name of files){
  if(!/\.(?:xml|rels)$/i.test(name))continue;
  const original=await zip.file(name).async('string'),cleaned=xml10Text(original);
  if(cleaned!==original){zip.file(name,cleaned);cleanedParts.push(name);}
 }
 const contentTypes=zip.file('[Content_Types].xml');
 if(!contentTypes)throw Error('PPTX 缺少部件类型清单');
 let types=await contentTypes.async('string');
 // PptxGenJS 4 can declare one master per slide while serializing only its
 // shared master. Remove stale declarations; never invent an empty master.
 types=types.replace(/<Override\b[^>]*\bPartName="([^"]+)"[^>]*\/>/g,(node,name)=>{
  const part=name.replace(/^\//,'');
  if(files.has(part))return node;
  removedDeclarations.push(part);return '';
 });
 zip.file('[Content_Types].xml',types);
 for(const name of files){
  if(!/\.(?:xml|rels)$/i.test(name))continue;
  const xml=await zip.file(name).async('string'),valid=XMLValidator.validate(xml);
  if(valid!==true)throw Error(`PPTX 部件无法解析：${name}（${valid.err.msg}）`);
  if(!name.endsWith('.rels'))continue;
  const owner=name==='_rels/.rels'?'':name.replace(/(^|\/)\_rels\//,'$1').replace(/\.rels$/,'');
  for(const rel of array(parser.parse(xml).Relationships?.Relationship)){
   if(rel['@_TargetMode']==='External')continue;
   const raw=String(rel['@_Target']||'').split('#')[0],target=raw.startsWith('/')?path.posix.normalize(raw).slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(owner),raw));
   if(!target||target.startsWith('../')||!files.has(target))throw Error(`PPTX 引用部件不存在：${name} → ${target}`);
  }
 }
 if(cleanedParts.length)warnings.push(`已清理 ${cleanedParts.length} 个部件中的 PDF 非法控制字符，原始证据仍保留。`);
 return {buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),report:{xmlParts:[...files].filter(name=>/\.(?:xml|rels)$/i.test(name)).length,cleanedParts,removedDeclarations,relationshipsValid:true},warnings};
}

export async function finalizePresentation(file){
 const result=await validatePresentationPackage(await fs.readFile(file));
 const temporary=file+'.validated.tmp';
 try{await fs.writeFile(temporary,result.buffer);await fs.rename(temporary,file);}
 catch(error){await fs.rm(temporary,{force:true});throw error;}
 return {report:result.report,warnings:result.warnings};
}
