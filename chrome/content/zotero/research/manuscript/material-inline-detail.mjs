/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {renderMaterialSourceView} from '../shared/material-source-view.mjs';
import {installMaterialHighlights,materialHighlightDisplay,materialHighlightGroups,MATERIAL_HIGHLIGHT_COLORS} from '../shared/material-highlights.mjs';
import {prepareMaterialChinese} from '../shared/material-translation.mjs';
import {renderTranslationFeedback} from '../shared/translation-feedback.mjs';
import {installMaterialMargin} from './material-margin.mjs';

// The source is selectable text. Authored prose remains a separate editor.
export function installInlineMaterialDetail(card,material,{E,summary,onOpen,onSave,onLocate,onError=()=>{},expanded=false,onExpanded=()=>{}}){
 const doc=card.ownerDocument,win=doc.defaultView,create=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 const margin=installMaterialMargin(card);let detail=null,disposers=[],collapsedDispose,controller,disposed=false,generation=0;
 const excerpts=create('div',undefined,'material-annotated-excerpts');card.append(excerpts);
 const refreshCollapsed=()=>{
  collapsedDispose?.();collapsedDispose=null;excerpts.replaceChildren();
  for(const group of materialHighlightGroups(material.highlights||[])){const quote=create('blockquote');for(const [index,row]of group.entries()){const display=materialHighlightDisplay(row),mark=create('mark',display.quote,'material-local-highlight');mark.dataset.highlightId=row.id;mark.dataset.style=display.style;mark.style.setProperty('--highlight-color',MATERIAL_HIGHLIGHT_COLORS[display.color]||MATERIAL_HIGHLIGHT_COLORS.blue);mark.title=display.comment;if(index)quote.append(doc.createTextNode('\n'));quote.append(mark);}excerpts.append(quote);}
  excerpts.hidden=!!detail||!excerpts.children.length;
  if(!detail)collapsedDispose=installMaterialHighlights(excerpts,material,{E,commentsOnly:true,commentsHost:margin.host,onLayout:margin.schedule,onError});margin.schedule();
 };
 const close=()=>{generation++;controller?.abort();for(const dispose of disposers)dispose?.();disposers=[];detail?.remove();detail=null;card.classList.remove('material-detail-open');summary.setAttribute('aria-expanded','false');onExpanded(false);refreshCollapsed();};
 const action=(parent,label,fn)=>{const button=create('button',label,'quiet-action');button.type='button';button.onclick=e=>{e.stopPropagation();Promise.resolve().then(fn).catch(onError);};parent.append(button);return button;};
 const open=({select=true}={})=>{
  if(disposed||detail)return;if(select)onOpen?.();collapsedDispose?.();collapsedDispose=null;excerpts.hidden=true;card.classList.add('material-detail-open');summary.setAttribute('aria-expanded','true');onExpanded(true);
  const request=++generation;controller=new win.AbortController();detail=create('section',undefined,'material-inline-detail');detail.lang='zh-CN';detail.setAttribute('aria-label','详细素材说明');card.append(detail);
  const bar=create('div',undefined,'material-inline-detail-heading');bar.append(create('span','完整素材','material-inline-detail-label'));action(bar,'收起',close).setAttribute('aria-label','收起详细素材');detail.append(bar);
  const grid=create('div',undefined,'material-inline-source-grid'),source=create('div',undefined,'material-inline-source');grid.append(source);detail.append(grid);
  source.append(create('p','正在准备中文素材…','material-source-translation-status'));
  let translatedText='',copy;
  const load=async()=>{translatedText='';if(copy)copy.disabled=true;source.replaceChildren(create('p','正在准备中文素材…','material-source-translation-status'));try{const value=await prepareMaterialChinese(material,{E,signal:controller.signal});if(disposed||request!==generation||!source.isConnected)return;source.replaceChildren();
   disposers.push(renderMaterialSourceView(source,value.material,{E,onLocate,onError}));
   translatedText=source.innerText||source.textContent;if(copy)copy.disabled=!translatedText.trim();
   disposers.push(installMaterialHighlights(source,material,{E,commentsHost:margin.host,translationContexts:value.translationContexts,onLayout:margin.schedule,onSave:async highlights=>{await onSave(highlights);if(disposed||!card.isConnected)return;close();open({select:false});},onError}));margin.schedule();
  }catch(error){if(disposed||request!==generation||controller.signal.aborted)return;renderTranslationFeedback(source,error,{onRetry:load,onOriginal:onLocate?()=>onLocate(material.anchor):null,onError});margin.schedule();}};
  const foot=create('div',undefined,'material-inline-detail-actions');detail.append(foot);copy=action(foot,'复制中文素材',async()=>{if(!translatedText.trim())return;const Zotero=E.window?.Zotero||win.parent?.Zotero;if(Zotero?.Utilities?.Internal?.copyTextToClipboard)Zotero.Utilities.Internal.copyTextToClipboard(translatedText);else await win.navigator.clipboard.writeText(translatedText);});copy.disabled=true;void load();
  if(material.anchor?.attachmentID||material.anchor?.url||material.sourceItemID)action(foot,'定位来源',()=>onLocate(material.anchor));
 };
 summary.tabIndex=0;summary.setAttribute('role','button');summary.setAttribute('aria-label','查看详细素材说明');summary.setAttribute('aria-expanded','false');
 const click=e=>{e.stopPropagation();const selection=win.getSelection();if(selection?.toString().trim()&&summary.contains(selection.anchorNode)&&summary.contains(selection.focusNode))return;open();};
 const keyboard=e=>{if(e.target!==summary||!['Enter',' '].includes(e.key))return;e.preventDefault();e.stopPropagation();open();};
 const contain=e=>e.stopPropagation();
 summary.addEventListener('click',click);summary.addEventListener('keydown',keyboard);card.addEventListener('click',contain);
 refreshCollapsed();if(expanded)open({select:false});
 return()=>{disposed=true;generation++;controller?.abort();for(const dispose of disposers)dispose?.();collapsedDispose?.();margin.dispose();detail?.remove();excerpts.remove();summary.removeEventListener('click',click);summary.removeEventListener('keydown',keyboard);card.removeEventListener('click',contain);};
}
