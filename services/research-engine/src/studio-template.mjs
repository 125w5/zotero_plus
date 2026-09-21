/* SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {XMLParser} from 'fast-xml-parser';
const array=v=>v?(Array.isArray(v)?v:[v]):[];
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',processEntities:false});
export async function importTemplate(file) {
 const bytes=await fs.readFile(file);if(bytes.length>25_000_000)throw Error('模板超过 25 MB，请使用精简母版');
 const zip=await JSZip.loadAsync(bytes);let expanded=0;
 for(const f of Object.values(zip.files)){expanded+=f._data?.uncompressedSize||0;if(expanded>100_000_000)throw Error('模板解压后过大');}
 const read=async name=>{const f=zip.file(name);if(!f)return {};const t=await f.async('string');if(t.length>4_000_000||/<!DOCTYPE|<!ENTITY/i.test(t))throw Error('模板 XML 无效');return parser.parse(t);};
 const t=(await read('ppt/theme/theme1.xml'))['a:theme']?.['a:themeElements'];if(!t)throw Error('没有找到 PowerPoint 主题，请使用 PPTX 文件');
 const color=(key,fallback)=>{const c=t['a:clrScheme']?.[key];const value=c?.['a:srgbClr']?.['@val']||c?.['a:sysClr']?.['@lastClr'];return /^[A-F\d]{6}$/i.test(value||'')?value:fallback;};
 const font=t['a:fontScheme']?.['a:minorFont']?.['a:ea']?.['@typeface']||t['a:fontScheme']?.['a:minorFont']?.['a:latin']?.['@typeface']||'Microsoft YaHei';
 const layouts=[];
 for(const name of Object.keys(zip.files).filter(n=>/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).slice(0,30)){
  const l=(await read(name))['p:sldLayout'];layouts.push({name:l?.['p:cSld']?.['@name']||l?.['@type']||name,slots:array(l?.['p:cSld']?.['p:spTree']?.['p:sp']).map(s=>({type:s['p:nvSpPr']?.['p:nvPr']?.['p:ph']?.['@type']||'body',text:array(s['p:txBody']?.['a:p']).flatMap(p=>array(p['a:r']).map(r=>r['a:t']||'')).join(' ')}))});
 }
 const master=(await read('ppt/slideMasters/slideMaster1.xml'))['p:sldMaster'];
 const slots=array(master?.['p:cSld']?.['p:spTree']?.['p:sp']).map(s=>{const x=s['p:spPr']?.['a:xfrm'];return {type:s['p:nvSpPr']?.['p:nvPr']?.['p:ph']?.['@type']||'body',x:Number(x?.['a:off']?.['@x'])/914400,y:Number(x?.['a:off']?.['@y'])/914400,w:Number(x?.['a:ext']?.['@cx'])/914400,h:Number(x?.['a:ext']?.['@cy'])/914400};}).filter(s=>[s.x,s.y,s.w,s.h].every(Number.isFinite));
 return {id:'imported',name:'导入模板',bg:color('a:lt1','FFFFFF'),text:color('a:dk1','243746'),accent:color('a:accent1','285B93'),muted:color('a:dk2','586F81'),soft:color('a:lt2','EDF3F8'),font:String(font).slice(0,80),layouts,slots,limitations:'已提取配色、字体、布局槽位；复杂背景图、动画和母版中的装饰元素不复制。'};
}
