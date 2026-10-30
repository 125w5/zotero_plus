/* SPDX-License-Identifier: AGPL-3.0-or-later */
export {selectPaperContext,sourcePageMetadata} from './chat-evidence.mjs';
// Conversation attachments are references to existing Zotero Sources/Materials,
// never a second file database or a copy of a material card.
export const CHAT_ATTACHMENT_MIME = 'application/x-easysch-chat-attachment';
export const CHAT_ATTACHMENT_LIMIT = 12;
export function conversationFileReferences(session={}) {
 return normalizeChatAttachments([...(session.attachments||[]),...(session.libraryFiles||[])]);
}
export function chatAttachmentState(item = {}) {
 return {selected:item.selected !== false,featured:item.featured === true,
  ...(typeof item.sheet==='string'&&item.sheet?{sheet:item.sheet}:{}),
  ...(Array.isArray(item.ranges)&&item.ranges.length?{ranges:item.ranges.filter(value=>typeof value==='string').slice(0,3)}:{})};
}
export function selectedChatAttachments(value=[],{featuredOnly=false}={}) {
 return normalizeChatAttachments(value).filter(item=>item.selected&&(!featuredOnly||item.featured));
}
export function chatFileScopeSignature(session={}){
 return JSON.stringify([conversationFileReferences(session).map(row=>[row.id,row.selected,row.sheet||'',row.ranges||[]]).sort((a,b)=>a[0].localeCompare(b[0])),[...(session.detachedAttachments||[])].sort()]);
}
function sourceReferenceMatch(reference,source={}){
 const stable=String(source.stableID||source.sourceID||''),materialID=source.materialID||source.id;
 if(reference.materialID){
  if(String(materialID)===String(reference.materialID)||stable==='material:'+reference.materialID||stable.startsWith('evidence:chat:'+reference.id+':')||source.id===reference.id||source.sourceID===reference.id)return 4;
  return 0;
 }
 if(stable.startsWith('evidence:chat:'+reference.id+':')||source.id===reference.id||source.sourceID===reference.id)return 4;
 const attachmentID=source.attachmentID||source.anchor?.attachmentID||source.evidenceAsset?.attachmentID||source.selection?.attachmentID;
 if(reference.attachmentID&&attachmentID&&String(reference.attachmentID)===String(attachmentID))return 3;
 if(reference.attachmentID&&reference.paperItemID&&stable.startsWith('evidence:paper:'+reference.paperItemID+':'+reference.attachmentID+':'))return 3;
 const paperID=source.paperItemID||source.paperID||source.anchor?.paperItemID||(source.kind==='paper'?source.id:null);
 if(reference.paperItemID&&paperID&&String(reference.paperItemID)===String(paperID))return 1;
 if(reference.paperItemID&&stable==='paper:'+reference.paperItemID)return 1;
 return 0;
}
// A removed whole PDF must not forbid a material that the user independently
// selects from that paper. Exact material/cell identity takes precedence over
// the broader paper relationship. Titles are never used to guess identity.
export function conversationChatFileContext(session={},history=[]){
 const current=conversationFileReferences(session),selected=current.filter(row=>row.selected),present=new Set(current.map(row=>row.id)),known=new Map(current.map(row=>[row.id,row]));
 for(const message of history||[])for(const ref of normalizeChatAttachments(message.attachments))if(!known.has(ref.id))known.set(ref.id,ref);
 if(session.libraryScopeKey)for(const message of history||[])for(const source of message.sources||[]){const attachmentID=source.attachmentID||source.anchor?.attachmentID;if(attachmentID){const id='attachment:'+attachmentID;if(!known.has(id))known.set(id,{id,attachmentID,paperItemID:source.paperItemID||source.anchor?.paperItemID});}}
 for(const id of session.detachedAttachments||[])if(!known.has(id)){
  const [kind,...parts]=String(id).split(':'),key=parts.join(':');known.set(id,{id,...(kind==='material'?{materialID:key}:kind==='attachment'?{attachmentID:Number(key)}:{})});
 }
 const blocked=[...known.values()].filter(row=>!present.has(row.id)||!current.find(ref=>ref.id===row.id)?.selected);
 const allowsSource=source=>{
  const local=source.materialID||source.attachmentID||source.paperItemID||source.paperID||source.anchor?.attachmentID||source.anchor?.paperItemID||source.kind==='material'||source.kind==='paper'||/^(?:material|attachment):/u.test(String(source.stableID||source.sourceID||''));
  if(session.libraryScopeKey&&local&&!selected.some(ref=>sourceReferenceMatch(ref,source)>0))return false;
  const denied=blocked.reduce((score,ref)=>Math.max(score,sourceReferenceMatch(ref,source)),0);if(!denied)return true;
  return selected.reduce((score,ref)=>Math.max(score,sourceReferenceMatch(ref,source)),0)>denied;
 };
 const messages=(history||[]).map(message=>{
  const sources=Array.isArray(message.sources)?message.sources:[],allowed=sources.filter(allowsSource);
  if(message.role==='assistant'&&allowed.length<sources.length)return {...message,text:'（这条旧回答使用的部分资料已取消选择或移除，本轮不引用其内容。）',sources:[],researchDecisions:[]};
  return {...message,...(sources.length?{sources:allowed}:{})};
 });
 return {allowsSource,history:messages,hasExclusions:blocked.length>0,signature:chatFileScopeSignature(session)};
}
function spreadsheetColumn(index){let text='';while(index>0){index--;text=String.fromCharCode(65+index%26)+text;index=Math.floor(index/26);}return text;}
export function chatSpreadsheetEvidence(workbook,reference={}){
 const result=[],sheet=workbook.selectedSheet;
 for(const section of workbook.sections||[]){
  let lines=[],size=0,first='',last='';const flush=()=>{if(!lines.length)return;const range=first===last?first:first+':'+last;result.push({text:`工作表「${sheet}」 · ${range}\n${lines.join('\n')}`,label:`${reference.title||'表格'} · ${sheet} · ${range}`,sheet,cellRange:range,sourceVersion:workbook.hash,parserVersion:workbook.version,coverage:'已读取所选工作表范围；Excel 公式未执行，空单元格未作为事实列出'});lines=[];size=0;first='';};
  for(const row of section.cells||[])for(const [offset,value]of row.values.entries()){
   if(value==='')continue;const address=spreadsheetColumn(section.startColumn+offset)+row.row,line=address+' = '+JSON.stringify(value);
   if(size+line.length>5600)flush();first||=address;last=address;lines.push(line);size+=line.length+1;
  }flush();
 }
 return result;
}
// Storage uses portable forward-slash keys; Gecko IOUtils/FileUtils require
// native separators on Windows. Keep keys stable and normalize only at I/O.
export function nativeChatFilePath(value, windows = false) {
 if (typeof value !== 'string') return value;
 return windows || /^(?:[a-z]:[\\/]|\\\\)/i.test(value) ? value.replace(/\//g,'\\') : value;
}
export function normalizeChatAttachments(value = []) {
 const seen = new Set();
 return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object' && typeof item.id === 'string' && /^(?:material|attachment|image):\S+$/u.test(item.id)).map(item => ({...item,...chatAttachmentState(item)})).filter(item => {
  if (seen.has(item.id)) return false; seen.add(item.id); return true;
 });
}
export function mergeChatAttachments(current, incoming) {
 const rows = normalizeChatAttachments(current), indexes = new Map(rows.map((row,index) => [row.id,index]));
 for (const row of normalizeChatAttachments(incoming)) {
  if (indexes.has(row.id)) {
   // Importing an existing file refreshes its identity, not a user's choice.
   const previous=rows[indexes.get(row.id)],raw=(Array.isArray(incoming)?incoming:[]).find(value=>value?.id===row.id)||{};
   rows[indexes.get(row.id)]={...previous,...row,...chatAttachmentState({...previous,...raw})};
  }
  else {indexes.set(row.id,rows.length);rows.push(row);}
 }
 // Keep unselected candidates in the conversation just like folder references.
 // The model context is limited by selection, not by the saved catalogue size.
 if (rows.filter(row=>row.selected).length > CHAT_ATTACHMENT_LIMIT) throw Error('本次最多选用 12 份资料，请先取消部分资料，再选择这一份。');
 return rows;
}
export function chatAttachmentDropPayload(dataTransfer) {
 const types = Array.from(dataTransfer?.types || []);
 if (types.includes('application/x-easysch-research-message')) return null;
 const payload = {files:Array.from(dataTransfer?.files || []),items:[],materialIDs:[]};
 const parse = raw => {try{return JSON.parse(raw);}catch(_){return raw;}};
 for (const type of [CHAT_ATTACHMENT_MIME,'application/x-easysch-material','application/x-manuscript-material','text/x-zotero-item','zotero/item']) {
  if (!types.includes(type)) continue;const value = parse(dataTransfer.getData(type));
  if (/material$/.test(type)) payload.materialIDs.push(...(Array.isArray(value)?value:[value]).map(row=>typeof row==='string'||typeof row==='number'?String(row):row?.materialID||row?.id).filter(Boolean));
  else if (type === CHAT_ATTACHMENT_MIME) {if(value&&typeof value==='object')payload.items.push(value);}
  else payload.items.push(...(Array.isArray(value)?value:typeof value==='string'?value.split(/[,\s]+/):[value]).filter(Boolean));
 }
 // Native dragover protects FileList/getData until drop. Recognize the MIME
 // now so the real drop is permitted, then read its actual payload on drop.
 return payload.files.length || payload.items.length || payload.materialIDs.length || types.some(type=>['Files',CHAT_ATTACHMENT_MIME,'application/x-easysch-material','application/x-manuscript-material','text/x-zotero-item','zotero/item'].includes(type)) ? payload : null;
}
// Read-only UTF-8 text under the 2 MB text limit; never executed.
export const CHAT_TEXT_EXTENSIONS = Object.freeze(['txt','md','json','yaml','yml','toml','py','js','ts','sh']);
export const CHAT_FILE_ACCEPT = ['.pdf','.docx','.xlsx','.xls','.csv','.png','.jpg','.jpeg','.webp',...CHAT_TEXT_EXTENSIONS.map(name=>'.'+name)].join(',');
export function chatAttachmentFileKind(name) {
 const extension = String(name || '').match(/\.([^.]+)$/)?.[1]?.toLowerCase();
 const kind = ({pdf:'pdf',docx:'docx',xlsx:'spreadsheet',xls:'spreadsheet',csv:'spreadsheet',png:'image',jpg:'image',jpeg:'image',webp:'image',...Object.fromEntries(CHAT_TEXT_EXTENSIONS.map(name=>[name,'text']))})[extension];
 if (!kind) throw Error('请选择 PDF、DOCX、Excel（XLSX/XLS）、CSV、图片，或 UTF-8 文本、Markdown、JSON、YAML、TOML 与代码文件。');
 return kind;
}
