/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {writingSnapshotHash} from './writing-source-snapshot.mjs';
const sourceText=material=>String(material.sourceText||material.anchor?.sourceText||'');
export const MATERIAL_HIGHLIGHT_COLORS=Object.freeze({blue:'#7aa9df',yellow:'#e5bd52',green:'#78b99a',pink:'#d995b9',purple:'#aa94d4'});
export const MATERIAL_HIGHLIGHT_STYLES=Object.freeze(['highlight','underline']);
function appearance({color='blue',style='highlight'}={}){if(!Object.hasOwn(MATERIAL_HIGHLIGHT_COLORS,color)||!MATERIAL_HIGHLIGHT_STYLES.includes(style))throw Error('请选择有效的标注颜色和样式');return {color,style};}
function normalized(value){let text='',offsets=[];for(let i=0;i<value.length;i++){if(value[i]==='-'&&/[A-Za-z]/.test(value[i-1]||'')){const lineBreak=value.slice(i).match(/^-\s*\n\s*(?=[a-z])/);if(lineBreak){i+=lineBreak[0].length-1;continue;}}if(/\s/u.test(value[i])){if(text.endsWith(' ')||!text)continue;text+=' ';offsets.push(i);}else{text+=value[i];offsets.push(i);}}return {text:text.trimEnd(),offsets};}
export function quoteRange(source,quote,{prefix='',suffix=''}={}){
 const hay=normalized(source),needle=normalized(String(quote||'')).text;if(!needle)return null;const before=normalized(prefix).text,after=normalized(suffix).text,matches=[];
 for(let at=hay.text.indexOf(needle);at>=0;at=hay.text.indexOf(needle,at+1)){
  if(before&&!hay.text.slice(0,at).trimEnd().endsWith(before.trim())||after&&!hay.text.slice(at+needle.length).trimStart().startsWith(after.trim()))continue;
  matches.push({start:hay.offsets[at],end:hay.offsets[at+needle.length-1]+1});
 }return matches.length===1?matches[0]:null;
}
// Displayed prose can omit a neighbouring math token or a PDF formatting run.
// A unique exact quote remains a safe anchor even when that display context
// differs. Repeated phrases still require matching context; never pick one.
export function selectionQuoteRange(source,quote,context={}){
 return quoteRange(source,quote,context)||quoteRange(source,quote);
}
export function createMaterialHighlight(material,quote,{prefix='',suffix='',comment='',id='highlight-'+Date.now(),color='blue',style='highlight'}={}){
 const source=sourceText(material),range=selectionQuoteRange(source,quote,{prefix,suffix});if(!range)throw Error('这段文字出现多次，请连同前后文一起选择');
 if(range.end-range.start>4000)throw Error('局部标注最多4000字符，完整素材仍保留');
 if(typeof comment!=='string'||comment.length>4000)throw Error('批注最多4000字符');
 return {id,...appearance({color,style}),quote:source.slice(range.start,range.end),start:range.start,end:range.end,prefix:source.slice(Math.max(0,range.start-48),range.start),suffix:source.slice(range.end,range.end+48),comment,sourceHash:writingSnapshotHash(source),sourceVersion:material.sourceVersion||'',at:new Date().toISOString()};
}
function sourceAnchor(value={}) {
 const anchor={};for(const key of ['attachmentID','paperItemID','citationItemID','pageIndex'])if(value[key]!=null){if(!Number.isInteger(value[key])||value[key]<(key==='pageIndex'?0:1))throw Error('标注来源位置无效');anchor[key]=value[key];}
 for(const key of ['sourceVersion','sourceRecordID','sourceText','annotationID','url'])if(value[key]!=null){if(typeof value[key]!=='string'||value[key].length>64000)throw Error('标注来源位置无效');anchor[key]=value[key];}
 if(value.position){const p=value.position;if(typeof p!=='object'||Array.isArray(p))throw Error('标注来源位置无效');anchor.position=JSON.parse(JSON.stringify(p));}
 return anchor;
}
function contextBelongs(material,context) {
 if(context.materialSourceHash!==writingSnapshotHash(sourceText(material)))return false;
 const candidates=[{...material,sourceText:sourceText(material)},material.anchor,...(material.anchors||[]),...(material.sourceAnchors||[]),...(material.sourceBlocks||[]).map(block=>({...block,...block.sourceAnchor,sourceText:block.originalText||block.sourceText}))].filter(Boolean);
 return candidates.some(candidate=>{
  const anchor=context.sourceAnchor||{},attachmentID=candidate.attachmentID||material.attachmentID||material.anchor?.attachmentID,pageIndex=candidate.pageIndex??material.pageIndex??material.anchor?.pageIndex;
  if(anchor.attachmentID&&anchor.attachmentID!==attachmentID||anchor.pageIndex!=null&&anchor.pageIndex!==pageIndex||anchor.sourceRecordID&&anchor.sourceRecordID!==candidate.sourceRecordID)return false;
  if(anchor.sourceVersion&&anchor.sourceVersion!==(candidate.sourceVersion||material.sourceVersion||''))return false;
  return quoteRange(String(candidate.sourceText||''),context.text)!==null;
 });
}
export function createTranslatedMaterialHighlight(material,quote,{context,prefix='',suffix='',comment='',id='highlight-'+Date.now(),color='blue',style='highlight'}={}) {
 if(!context||context.textHash!==writingSnapshotHash(context.text)||context.sourceHash!==writingSnapshotHash(context.sourceText))throw Error('中文素材的原文关联已变化，请重新展开素材');
 const range=selectionQuoteRange(context.text,quote,{prefix,suffix});if(!range)throw Error('这段文字出现多次，请连同前后文一起选择');
 if(range.end-range.start>4000||typeof comment!=='string'||comment.length>4000)throw Error('局部标注和批注最多4000字符');
 const originalContext={text:context.sourceText,sourceAnchor:sourceAnchor(context.sourceAnchor),materialSourceHash:context.materialSourceHash,scope:'source-block'};
 if(!contextBelongs(material,originalContext))throw Error('中文素材与当前原文不一致，请重新展开素材');
 return {id,...appearance({color,style}),quote:context.sourceText,start:0,end:context.sourceText.length,prefix:'',suffix:'',comment,
  sourceHash:context.sourceHash,sourceVersion:context.sourceVersion||'',at:new Date().toISOString(),originalContext,
  translation:{text:context.text,textHash:context.textHash,quote:context.text.slice(range.start,range.end),start:range.start,end:range.end,
   prefix:context.text.slice(Math.max(0,range.start-48),range.start),suffix:context.text.slice(range.end,range.end+48),
   sourceBlockHash:context.sourceHash,sourceAnchor:sourceAnchor(context.sourceAnchor),scope:'source-block'}};
}
export function createContextMaterialHighlight(material,quote,{context,...options}={}) {
 if(!context||context.sourceHash!==writingSnapshotHash(context.sourceText))throw Error('素材的原文关联已变化，请重新展开素材');
 const originalContext={text:context.sourceText,sourceAnchor:sourceAnchor(context.sourceAnchor),materialSourceHash:context.materialSourceHash,scope:'source-block'};
 if(!contextBelongs(material,originalContext))throw Error('素材与当前原文不一致，请重新展开素材');
 return {...createMaterialHighlight({sourceText:context.sourceText,sourceVersion:context.sourceVersion||''},quote,options),originalContext};
}
let groupSequence=0;
// A continuous selection may cross several PDF text blocks. Keep each real
// block anchor separate, while presenting the user's selection as one comment.
// A translated character range never claims word-level PDF coordinates.
export function createMaterialHighlightGroup(material,selections,options={}) {
 if(!Array.isArray(selections)||!selections.length||selections.length>100)throw Error('请选择同一完整素材中的连续文字');
 if(selections.reduce((sum,row)=>sum+String(row.quote||'').length,0)>4000)throw Error('局部标注最多4000字符，完整素材仍保留');
 const groupID='highlight-group-'+Date.now()+'-'+(++groupSequence),seen=new Set();let previous=-1;
 return selections.map((selection,index)=>{
  const {context,quote,prefix='',suffix=''}=selection;
  if(context){if(seen.has(context.id)||Number.isInteger(context.blockIndex)&&context.blockIndex<=previous)throw Error('请选择同一完整素材中的连续文字');seen.add(context.id);previous=context.blockIndex??previous;}
  const settings={...options,prefix,suffix,id:groupID+'-'+index};
  const row=context?context.text!==context.sourceText?createTranslatedMaterialHighlight(material,quote,{...settings,context}):createContextMaterialHighlight(material,quote,{...settings,context}):createMaterialHighlight(material,quote,settings);
  return selections.length>1?{...row,groupID}:row;
 });
}
export function materialHighlightGroups(highlights=[]) {
 const groups=new Map();for(const row of highlights){const key=row.groupID||row.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}return [...groups.values()];
}
export function materialHighlightDisplay(highlight){return {quote:highlight.translation?.quote||highlight.quote,color:highlight.color||'blue',style:highlight.style||'highlight',comment:highlight.comment,translated:!!highlight.translation};}
export function resolveMaterialHighlight(material,highlight){
 const source=highlight.originalContext?.text??sourceText(material);
 if(highlight.originalContext&&!contextBelongs(material,highlight.originalContext))return null;
 const version=highlight.originalContext?.sourceAnchor?.sourceVersion||material.sourceVersion||'';
 if(highlight.sourceHash!==writingSnapshotHash(source)||highlight.sourceVersion!==version)return null;
 if(source.slice(highlight.start,highlight.end)===highlight.quote)return {start:highlight.start,end:highlight.end};return quoteRange(source,highlight.quote,highlight);
}
export function normalizeMaterialHighlights(value,material){
 if(!Array.isArray(value)||value.length>100)throw Error('每块素材最多100条局部标注');const ids=new Set();
 return value.map(row=>{if(typeof row?.id!=='string'||!row.id||ids.has(row.id)||typeof row.quote!=='string'||!row.quote||row.quote.length>(row.translation?64000:4000)||typeof row.comment!=='string'||row.comment.length>4000||typeof row.sourceHash!=='string'||!Number.isInteger(row.start)||!Number.isInteger(row.end)||row.start<0||row.end<=row.start)throw Error('局部标注格式无效');ids.add(row.id);const next={id:row.id,quote:row.quote,start:row.start,end:row.end,prefix:String(row.prefix||'').slice(-48),suffix:String(row.suffix||'').slice(0,48),comment:row.comment,sourceHash:row.sourceHash,sourceVersion:String(row.sourceVersion||''),at:String(row.at||'')};
  Object.assign(next,appearance(row));
  if(row.groupID!==undefined){if(typeof row.groupID!=='string'||!row.groupID||row.groupID.length>120)throw Error('局部标注分组无效');next.groupID=row.groupID;}
  if(row.originalContext){
   const o=row.originalContext;
   if(typeof o.text!=='string'||o.text.length>64000||o.scope!=='source-block'||typeof o.materialSourceHash!=='string'||writingSnapshotHash(o.text)!==row.sourceHash||o.text.slice(row.start,row.end)!==row.quote)throw Error('标注与原文关联无效');
   next.originalContext={text:o.text,sourceAnchor:sourceAnchor(o.sourceAnchor),materialSourceHash:o.materialSourceHash,scope:'source-block'};
  }
  if(row.translation){
   const t=row.translation,o=row.originalContext;
   if(!o||row.quote!==o.text||row.start!==0||row.end!==o.text.length||typeof t.text!=='string'||t.text.length>64000||t.textHash!==writingSnapshotHash(t.text)||typeof t.quote!=='string'||!t.quote||t.quote.length>4000||!Number.isInteger(t.start)||!Number.isInteger(t.end)||t.start<0||t.end<=t.start||t.text.slice(t.start,t.end)!==t.quote||t.sourceBlockHash!==row.sourceHash||t.scope!=='source-block')throw Error('中文标注与原文关联无效');
   next.translation={text:t.text,textHash:t.textHash,quote:t.quote,start:t.start,end:t.end,prefix:String(t.prefix||'').slice(-48),suffix:String(t.suffix||'').slice(0,48),sourceBlockHash:t.sourceBlockHash,sourceAnchor:sourceAnchor(t.sourceAnchor),scope:'source-block'};
  }
  // Existing annotations may be stale. They remain visible for review and are
  // never silently moved onto different source text.
  if(material&&(next.originalContext?next.originalContext.materialSourceHash===writingSnapshotHash(sourceText(material)):next.sourceHash===writingSnapshotHash(sourceText(material)))&&!resolveMaterialHighlight(material,next))throw Error('标注与当前原文不一致');return next;
 });
}
function textNodes(host){
 const doc=host.ownerDocument,walker=doc.createTreeWalker(host,doc.defaultView.NodeFilter.SHOW_TEXT),nodes=[];let text='',node,previousBlock;
 while(node=walker.nextNode()){
  if(node.parentElement.closest('.katex,button,textarea'))continue;
  const block=node.parentElement.closest('p,li,pre,td,th,blockquote,h1,h2,h3,h4,h5,h6,.agent-source-block');
  if(nodes.length&&block!==previousBlock)text+='\n';
  nodes.push({node,start:text.length,end:text.length+node.length});text+=node.data;previousBlock=block;
 }return {text,nodes};
}
function markQuote(host,highlight){
 const doc=host.ownerDocument,{text,nodes}=textNodes(host),match=quoteRange(text,highlight.quote,highlight)||quoteRange(text,highlight.quote),marks=[];if(!match)return marks;
 // Wrap only text fragments. Extracting one Range across paragraphs would move
 // their elements into a mark and destroy translation-context boundaries.
 for(const row of nodes){const start=Math.max(match.start,row.start),end=Math.min(match.end,row.end);if(end<=start)continue;
  const range=doc.createRange();range.setStart(row.node,start-row.start);range.setEnd(row.node,end-row.start);const mark=doc.createElement('mark');mark.className='material-local-highlight';mark.dataset.highlightId=highlight.id;mark.dataset.style=highlight.style||'highlight';mark.style.setProperty('--highlight-color',MATERIAL_HIGHLIGHT_COLORS[highlight.color]||MATERIAL_HIGHLIGHT_COLORS.blue);mark.title=highlight.comment||'';mark.append(range.extractContents());range.insertNode(mark);marks.push(mark);
 }return marks;
}
/** Read the ordered DOM Range, rather than anchor/focus direction. Capture it
 * before preview marks alter text nodes, so either drag direction has the same
 * exact original/translated block anchors. */
export function captureMaterialSelections(host,range,translationContexts=[]){
 const fragment=(target,context)=>{
  const {text,nodes}=textNodes(target);let start,end;
  for(const row of nodes){if(!range.intersectsNode(row.node))continue;const from=row.node===range.startContainer?range.startOffset:0,to=row.node===range.endContainer?range.endOffset:row.node.length;if(to<=from)continue;if(start===undefined)start=row.start+from;end=row.start+to;}
  if(start===undefined||!text.slice(start,end).trim())return null;
  return {context,quote:text.slice(start,end),prefix:text.slice(Math.max(0,start-48),start),suffix:text.slice(end,end+48)};
 };
 return translationContexts.length?Array.from(host.querySelectorAll('[data-translation-context-id]')).filter(target=>range.intersectsNode(target)).map(target=>fragment(target,translationContexts.find(row=>row.id===target.dataset.translationContextId))).filter(row=>row?.context):[fragment(host)].filter(Boolean);
}
export function installMaterialHighlights(host,material,{E,onSave,onError=()=>{},commentsHost,translationContexts=[],commentsOnly=false,onLayout=()=>{}}){
 const doc=host.ownerDocument,win=doc.defaultView,create=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 const list=create('div',undefined,'material-local-comments');if(commentsHost)commentsHost.append(list);else host.after(list);let disposed=false,draft,selectionKey='',selectTimer;const permanentMarks=[],originalContexts=[];
 const button=(parent,label,action)=>{const node=create('button',label,'quiet-action');node.type='button';node.onclick=()=>Promise.resolve().then(action).catch(onError);parent.append(node);return node;};
 const contextHost=context=>Array.from(host.querySelectorAll('[data-translation-context-id]')).find(node=>node.dataset.translationContextId===context.id)||host;
 const paint=highlight=>{
  const resolved=resolveMaterialHighlight(material,highlight);let marks=[],translationChanged=false;
  if(!commentsOnly&&resolved&&translationContexts.length){
   const anchor=highlight.originalContext?.sourceAnchor||highlight.translation?.sourceAnchor;
   const context=translationContexts.find(row=>(!anchor||['attachmentID','pageIndex','sourceVersion','sourceRecordID'].every(key=>anchor[key]==null||anchor[key]===(row.sourceAnchor||{})[key]))&&(highlight.translation?row.sourceHash===highlight.translation.sourceBlockHash:quoteRange(row.sourceText,highlight.quote,highlight)||quoteRange(row.sourceText,highlight.quote)));
   if(context){
    if(highlight.translation){translationChanged=context.textHash!==highlight.translation.textHash;if(!translationChanged)marks=markQuote(contextHost(context),{...highlight,...highlight.translation});}
    else if(context.text===context.sourceText)marks=markQuote(contextHost(context),highlight);
    else {const target=contextHost(context);target.dataset.originalHighlightId=highlight.id;target.style.setProperty('--highlight-color',MATERIAL_HIGHLIGHT_COLORS[highlight.color]||MATERIAL_HIGHLIGHT_COLORS.blue);target.classList.add('material-original-highlight-context');originalContexts.push(target);}
   }
  }else if(!commentsOnly&&resolved)marks=markQuote(host,highlight);
  permanentMarks.push(...marks);return {resolved,marks,translationChanged};
 };
 for(const group of materialHighlightGroups(material.highlights||[])){
  const highlight=group[0],painted=group.map(paint),display=materialHighlightDisplay(highlight);
  const item=create('article',undefined,'material-local-comment');item.dataset.highlightId=highlight.id;item.dataset.materialId=material.id;item.tabIndex=-1;item.style.setProperty('--highlight-color',MATERIAL_HIGHLIGHT_COLORS[highlight.color]||MATERIAL_HIGHLIGHT_COLORS.blue);const quote=create('blockquote',group.map(row=>materialHighlightDisplay(row).quote).join('\n')),comment=create('div',undefined,'material-comment-text');if(E.renderContent)E.renderContent(comment,highlight.comment);else comment.textContent=highlight.comment;item.append(quote,comment);if(painted.some(row=>!row.resolved))item.append(create('small','来源已变化，标注保留待核对'));else if(painted.some(row=>row.translationChanged))item.append(create('small','译文已更新，保留原标注与原文位置'));list.append(item);
  // A compact margin (manuscript/material-margin.mjs) keeps saved comments as a
  // badge; this event lets it open the comment beside the clicked highlight.
  for(const mark of painted.flatMap(row=>row.marks))mark.onclick=event=>{event.stopPropagation();if(win.getSelection()?.toString())return;const revealed=win.CustomEvent?!mark.dispatchEvent(new win.CustomEvent('material-highlight-reveal',{bubbles:true,cancelable:true,detail:{highlightId:highlight.id}})):false;item.focus({preventScroll:true});if(!revealed)item.scrollIntoView({block:'nearest'});};if(onSave)button(item,'移除标注',async()=>{const ids=new Set(group.map(row=>row.id));await onSave((material.highlights||[]).filter(row=>!ids.has(row.id)));});
 }
 onLayout(list);
 let previewMarks=[];
 const removePreview=()=>{for(const mark of previewMarks){const parent=mark.parentNode;mark.replaceWith(...mark.childNodes);parent?.normalize();}previewMarks=[];};
 const clear=()=>{selectionKey='';removePreview();draft?.remove();draft=null;onLayout(list);};
 const select=()=>{
  if(commentsOnly||!onSave)return;const selection=win.getSelection();if(!selection?.rangeCount||!selection.toString().trim()||!host.contains(selection.anchorNode)||!host.contains(selection.focusNode))return;
  const range=selection.getRangeAt(0);if(range.cloneContents().querySelector('.katex,img'))return;
  const selected=captureMaterialSelections(host,range,translationContexts);
  if(!selected.length)return;
  const key=JSON.stringify(selected.map(row=>[row.context?.id,row.quote,row.prefix,row.suffix]));if(key===selectionKey)return;selectionKey=key;
  try{createMaterialHighlightGroup(material,selected);}catch(error){clear();selectionKey=key;draft=create('p',error.message,'material-highlight-draft material-selection-hint');draft.setAttribute('role','status');list.prepend(draft);onLayout(list);return;}
  const quoted=selected.map(row=>row.quote).join('\n');
  clear();selectionKey=key;const popup=draft=create('div',undefined,'material-highlight-draft');list.prepend(popup);popup.append(create('blockquote',quoted));let color='blue',style='highlight';const palette=create('div',undefined,'material-highlight-palette'),styles=create('div',undefined,'material-highlight-styles');palette.setAttribute('aria-label','标注颜色');styles.setAttribute('aria-label','标注样式');popup.append(palette,styles);
  const preview=()=>{removePreview();for(const row of selected){const marks=markQuote(row.context?contextHost(row.context):host,{...row,id:'preview',color,style});for(const mark of marks)mark.dataset.preview='true';previewMarks.push(...marks);}selection.removeAllRanges();};
  for(const [value,tone] of Object.entries(MATERIAL_HIGHLIGHT_COLORS)){const labels={blue:'蓝色',yellow:'黄色',green:'绿色',pink:'粉色',purple:'紫色'},choice=button(palette,'',()=>{color=value;for(const n of palette.children)n.setAttribute('aria-pressed',String(n===choice));preview();});choice.className='material-highlight-color';choice.dataset.color=value;choice.style.setProperty('--highlight-color',tone);choice.setAttribute('aria-label',labels[value]);choice.setAttribute('aria-pressed',String(value===color));}
  for(const [value,label] of [['highlight','高亮'],['underline','下划线']]){const choice=button(styles,label,()=>{style=value;for(const n of styles.children)n.setAttribute('aria-pressed',String(n===choice));preview();});choice.dataset.style=value;choice.setAttribute('aria-pressed',String(value===style));}
  const input=create('textarea');input.rows=2;input.placeholder='记录这段素材如何用于论文';input.setAttribute('aria-label','局部批注');popup.append(input);
  button(popup,'保存标注',async()=>{const highlights=createMaterialHighlightGroup(material,selected,{comment:input.value,color,style});if((material.highlights||[]).length+highlights.length>100)throw Error('每块素材最多100条局部标注');if(disposed)return;await onSave([...(material.highlights||[]),...highlights]);clear();});button(popup,'取消',clear);preview();onLayout(list);
 };
 const queueSelect=event=>{if(event.type==='keyup'&&!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;win.clearTimeout(selectTimer);selectTimer=win.setTimeout(select,0);};
 host.addEventListener('mouseup',queueSelect);host.addEventListener('keyup',queueSelect);return()=>{disposed=true;win.clearTimeout(selectTimer);host.removeEventListener('mouseup',queueSelect);host.removeEventListener('keyup',queueSelect);clear();for(const mark of permanentMarks){const parent=mark.parentNode;if(parent){mark.replaceWith(...mark.childNodes);parent.normalize();}}for(const target of originalContexts){delete target.dataset.originalHighlightId;target.classList.remove('material-original-highlight-context');target.style.removeProperty('--highlight-color');}list.remove();onLayout(list);};
}
