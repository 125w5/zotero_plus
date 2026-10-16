/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {renderAssemblyWritingResult} from './assembly-writing-result.mjs';

const typeNames={table:'表格',formula:'公式',image:'图片',citation:'引用',placeholder:'待填内容',heading:'小标题',list:'列表',crossref:'交叉引用'};
export function moduleWordCount(block){
 const value=String(block?.type==='table'?block.table?.rows?.flat().filter(cell=>!cell.hidden).map(cell=>cell.text).join(' ')||'':block?.text||'');
 const cjk=value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)||[];
 const words=value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,' ').match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)||[];
 return cjk.length+words.length;
}
export function moduleDetailCurrent(U,block,root,project=U.p){
 return !!root?.isConnected&&U.p===project&&!U.previewMaterialID&&U.p.ui.blockID===block.id&&U.p.blocks.includes(block);
}
/** The panel is bound to a selected block, never to a hover or screen region. */
export function renderModuleDetails(U,host,b,{el,button,field,snapshot,changed,persist,status,selectBlock,materialDetails,openMaterial,findEvidence,verifyBlock}){
 const p=U.p,doc=host.ownerDocument,root=el('section',undefined,'module-detail-surface');root.dataset.blockId=b.id;host.dataset.blockId=b.id;
 if(!doc.getElementById('module-details-styles')){const style=el('link');style.id='module-details-styles';style.rel='stylesheet';style.href=new URL('./module-details.css',import.meta.url).href;doc.head.append(style);}
 host.append(root);
 const isCurrent=()=>moduleDetailCurrent(U,b,root,p);
 const guard=fn=>(...args)=>{if(!isCurrent())return;return fn(...args);};
 // Detached controls can still receive programmatic events. Their captured
 // block must not change after another block/project/preview becomes active.
 const preventStale=event=>{if(isCurrent())return;event.preventDefault();event.stopImmediatePropagation();};
 for(const name of ['click','change','input','beforeinput','keydown'])root.addEventListener(name,preventStale,true);
 const act=(label,action,hostNode,className='module-action')=>{const control=button(label,guard(action),hostNode,className);control.dataset.moduleAction=action.actionID||'';return control;};
 const header=el('div',undefined,'module-detail-heading'),title=el('h3','装配结果'),state=el('span',undefined,'module-detail-state');header.append(title,state);root.append(header);
 const position=el('div',undefined,'module-detail-position'),trail=el('span'),navigation=el('div',undefined,'module-detail-navigation');position.append(trail,navigation);root.append(position);
 const sectionBlocks=p.blocks.filter(value=>value.sectionID===b.sectionID),index=sectionBlocks.indexOf(b);
 for(const [offset,label,glyph]of [[-1,'上一模块','↑'],[1,'下一模块','↓']]){const control=act(glyph,()=>selectBlock(sectionBlocks[index+offset].id,{scroll:true}),navigation,'module-navigation-button');control.setAttribute('aria-label',label);control.title=label;control.disabled=!sectionBlocks[index+offset];}
 const metrics=el('div',undefined,'module-detail-metrics'),words=el('span'),sourcesCount=el('span');metrics.append(words,sourcesCount);root.append(metrics);
 const update=()=>{if(!isCurrent())return;const section=p.sections.find(value=>value.id===b.sectionID);trail.textContent=`${section?.title||'章节'} · 第 ${index+1} / ${sectionBlocks.length} 个模块`;words.textContent=moduleWordCount(b)+' 字 / 词';sourcesCount.textContent=b.materials.length+' 个来源';state.textContent=b.locked?'已锁定':b.review==='verified'?'已核验':b.review==='conflict'?'有冲突':b.review==='stale'?'来源有更新':b.claim?'待核验论点':'编辑中';state.dataset.state=b.locked?'locked':b.review;};
 const body=el('div',undefined,'module-detail-body');root.append(body);
 renderAssemblyWritingResult(U,root,b,{el,button,snapshot,changed,persist,status,isCurrent,materialDetails});
 const sourceTray=el('section',undefined,'module-sources'),sourceHeader=el('div',undefined,'detail-heading');sourceHeader.append(el('h4','本模块来源'),el('small',String(b.materials.length)));sourceTray.append(sourceHeader);root.append(sourceTray);
 const sourceActions=el('div',undefined,'module-source-actions');sourceTray.append(sourceActions);
 const find=act('查找依据',()=>findEvidence(b.text||b.requirements||p.memory?.goal||''),sourceActions,'module-source-tool');find.dataset.action='find-module-evidence';find.title='检索当前模块相关的素材与原文';
 const verify=act('核验依据',()=>verifyBlock(b),sourceActions,'module-source-tool');verify.dataset.action='verify-module';verify.disabled=!b.materials.length;verify.title=b.materials.length?'对照此模块的真实来源检查内容':'先为此模块关联来源';
 for(const link of b.materials){
  const material=p.materials.find(value=>value.id===link.id),row=el('article',undefined,'module-source-row');row.dataset.materialId=link.id;
  if(!material){row.append(el('p','此来源当前不可用','muted'));sourceTray.append(row);continue;}
  const heading=el('div',undefined,'module-source-heading'),preview=act(U.A.titleFor(material),()=>materialDetails(material),heading,'module-source-name');preview.dataset.action='preview-material';preview.dataset.materialId=material.id;preview.title='查看此模块关联的素材说明与原文';
  const locate=act('↗',()=>openMaterial(material),heading,'module-source-locate');locate.setAttribute('aria-label','定位此素材原文');locate.title='定位此素材原文';locate.dataset.action='locate-module-source';row.append(heading);
  const meta=el('div',undefined,'module-source-meta');meta.append(el('span',[material.paperTitle||material.anchor?.paperTitle,Number.isInteger(material.anchor?.pageIndex)?'第 '+(material.anchor.pageIndex+1)+' 页':({note:'笔记',annotation:'批注',formula:'公式',image:'图片',experiment:'实验素材'})[material.kind]||'素材'].filter(Boolean).join(' · ')));
  const role=el('select');role.setAttribute('aria-label','素材在本模块的用途');for(const [value,label]of [['primary','主要素材'],['support','辅助素材'],['reference','参考方向']]){const option=el('option',label);option.value=value;role.append(option);}role.value=link.role||'primary';role.dataset.materialId=material.id;role.disabled=!!b.locked;
  role.onchange=guard(()=>{if(b.locked)return;snapshot();link.role=role.value;b.revision++;b.review='missing';changed();});meta.append(role);row.append(meta);sourceTray.append(row);
 }
 if(!b.materials.length)sourceTray.append(el('p','将素材拖入当前模块，或检索后选择素材。','module-source-empty'));
 const options=el('details',undefined,'module-detail-options');options.append(el('summary','写作设置'));root.append(options);
 const flags=el('div',undefined,'module-detail-flags');options.append(flags);
 const lock=act(b.locked?'解锁内容':'锁定内容',()=>{snapshot();b.locked=!b.locked;changed({editor:true});},flags);lock.dataset.action='toggle-module-lock';lock.setAttribute('aria-pressed',String(!!b.locked));
 const page=act(b.pageBreakBefore?'取消段前分页':'段前分页',()=>{if(b.locked)throw Error('此模块已锁定，请先解锁');snapshot();b.pageBreakBefore=!b.pageBreakBefore;changed({editor:true});},flags);page.dataset.action='toggle-module-page';page.disabled=!!b.locked;page.setAttribute('aria-pressed',String(!!b.pageBreakBefore));
 if(b.materials.length){const frame=act(b.hideMaterialFrame?'显示素材框':'隐藏素材框',()=>{if(b.locked)throw Error('此模块已锁定，请先解锁');snapshot();b.hideMaterialFrame=!b.hideMaterialFrame;changed({editor:true});},flags);frame.dataset.action='toggle-module-frame';frame.disabled=!!b.locked;frame.title='保留正文和全部来源，只切换素材框显示';}
 const requirements=field(options,'写作目标',b.requirements,guard(value=>{if(b.locked)return;snapshot();b.requirements=value;persist();}),'textarea');requirements.dataset.action='module-requirements';requirements.placeholder='记录此段要回答的问题，不导出正文';requirements.disabled=!!b.locked;
 const target=field(options,'目标字 / 词数',b.targetWords,guard(value=>{if(b.locked)return;snapshot();b.targetWords=Math.min(50000,Math.max(30,Number(value)||300));persist();}));target.type='number';target.min='30';target.max='50000';target.disabled=!!b.locked;
 const claim=el('label',undefined,'module-detail-claim'),checkbox=el('input');checkbox.type='checkbox';checkbox.checked=!!b.claim;checkbox.disabled=!!b.locked;checkbox.onchange=guard(()=>{if(b.locked)return;snapshot();b.claim=checkbox.checked;if(b.claim)b.review='missing';changed({editor:true});});claim.append(checkbox,el('span','此模块包含需核验的论点'));options.append(claim);
 const remove=act('删除此模块',()=>{if(b.locked)throw Error('此模块已锁定，请先解锁');snapshot();const at=p.blocks.indexOf(b),next=p.blocks[at+1]||p.blocks[at-1];p.blocks.splice(at,1);p.ui.blockID=next?.id||null;if(next)p.ui.sectionID=next.sectionID;changed({editor:true});status('已删除模块，可按 Ctrl+Z 撤销。');},options,'module-delete-action');remove.dataset.action='delete-module';remove.disabled=!!b.locked;
 const updateOnInput=event=>{if(event.target.closest?.('.block')?.dataset.id===b.id)update();};U.$('canvas').addEventListener('input',updateOnInput);update();
 U.disposeModuleDetails=()=>{U.$('canvas').removeEventListener('input',updateOnInput);if(host.dataset.blockId===b.id)delete host.dataset.blockId;};
 return {root,body,isCurrent,guard};
}
