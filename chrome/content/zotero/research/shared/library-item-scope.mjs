/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A reversible library view; never infer or rewrite a user's parentItemID.
export function libraryItemScopeActive(tree){
 return ['papers','unlinked'].includes(tree?.researchItemScope)&&tree.collectionTreeRows?.length>0&&tree.collectionTreeRows.every(row=>row.isLibrary?.(true)||row.isCollection?.()||row.isRecentlyRead?.()||row.isPublications?.());
}
export function belongsToLibraryScope(item,scope,getItem,isAssemblyProject=()=>false){
 if(!['papers','unlinked'].includes(scope))return true;
 const regular=item.isRegularItem?.()===true;
 const parent=item.parentItemID||item.parentID;
 const project=!!isAssemblyProject(item);
 if(scope==='unlinked')return project||(!regular&&!parent&&(item.isNote?.()||item.isAttachment?.())&&!item.isEmbeddedImageAttachment?.());
 if(regular)return !project;
 let ancestor=item;const visited=new Set();
 for(let depth=0;depth<4;depth++){
  const id=ancestor.parentItemID||ancestor.parentID;if(!id||visited.has(id))return false;visited.add(id);ancestor=getItem(id);
  if(!ancestor)return false;if(ancestor.isRegularItem?.())return !isAssemblyProject(ancestor);
 }
 return false;
}
