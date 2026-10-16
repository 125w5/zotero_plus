/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {insertAssemblyPage,placeAssemblyMaterial} from '../shared/assembly-pages.mjs';

export function installAssemblyPages(U,{snapshot,changed,persist,status}){
 const pageRows=page=>[...(page?.querySelectorAll?.(':scope>.block')||[])];
 const paperPages=()=>[...(U.$('canvas')?.querySelectorAll?.('.paper')||[])].filter(page=>page?.dataset?.section);
 const pageAnchor=(sectionID,anchorID,position)=>{
  const block=anchorID?U.$('canvas')?.querySelector?.('[data-id="'+anchorID+'"]'):null,bound=block?.closest?.('.paper'),page=bound?.dataset?.section===sectionID?bound:paperPages().filter(node=>node.dataset.section===sectionID).at(position==='before'?0:-1);
  const rows=pageRows(page);return (position==='before'?rows[0]:rows.at(-1))?.dataset?.id||anchorID||'';
 };
 U.captureAssemblyPageBounds=context=>{
  // An empty discussion has no selected block yet. Keep that state as null:
  // short-circuiting on blockID would produce a string without a dataset.
  const pages=paperPages(),bounds=page=>{const ids=pageRows(page).map(node=>node?.dataset?.id).filter(Boolean);return {sectionID:page.dataset.section,firstID:ids[0]||'',lastID:ids.at(-1)||''};};
  const selected=context?.blockID?U.$('canvas')?.querySelector?.('[data-id="'+context.blockID+'"]')?.closest?.('.paper'):null;
  const current=pages.includes(selected)&&selected.dataset.section===context?.sectionID?selected:pages.find(page=>page.dataset.section===context?.sectionID);
  const sections=(U.p.sections||[]).map(section=>{const rows=pages.filter(page=>page.dataset.section===section.id);return {sectionID:section.id,firstID:rows.length?bounds(rows[0]).firstID:'',lastID:rows.length?bounds(rows.at(-1)).lastID:''};});
  return {current:current?bounds(current):null,sections};
 };
 const show=result=>{U.previewMaterialID=null;U.p.ui.materialID=null;changed({editor:true});U.selectBlock(result.blockID,{scroll:true});return result;};
 U.insertAssemblyPage=(options={})=>{const sectionID=options.sectionID||U.p.ui.sectionID||U.p.sections[0]?.id,position=options.position||'after',anchorID=options.resolvedPageAnchor?options.anchorID||'':pageAnchor(sectionID,options.anchorID??U.p.ui.blockID,position),candidate=U.M.clone(U.p),result=insertAssemblyPage(candidate,U.M,{sectionID,position,anchorID});snapshot();U.p=candidate;show(result);status('已新增同章节页面 · Ctrl+Z 撤销');return result;};
 U.placeAssemblyMaterial=(material,options={})=>{const candidate=U.M.clone(U.p),result=placeAssemblyMaterial(candidate,U.M,material,{sectionID:options.sectionID||U.p.ui.sectionID,anchorID:options.anchorID||'',pageID:options.pageID||''});snapshot();U.p=candidate;show(result);return result;};
 const host=U.$('insert-tools').querySelector('.manuscript-insert-actions'),control=U.el('button','新增一页');control.type='button';control.dataset.action='insert-assembly-page';control.title='在当前页后新增同章节页面';control.onclick=()=>{try{U.insertAssemblyPage();persist({flush:true});}catch(error){status(error.message,true);}};host.append(control);
}
