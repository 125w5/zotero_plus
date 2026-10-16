/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Drop anchors are scoped to the paper's chapter. A save can yield while the
// user moves or removes a block, so a global neighbour is never a safe anchor.
export function sectionInsertionIndex(blocks, sections, sectionID, {beforeID, afterID} = {}) {
 const before = beforeID ? blocks.findIndex(block => block.id === beforeID && block.sectionID === sectionID) : -1;
 if (before >= 0) return before;
 const after = afterID ? blocks.findIndex(block => block.id === afterID && block.sectionID === sectionID) : -1;
 if (after >= 0) return after + 1;
 for (let index = blocks.length - 1; index >= 0; index--) if (blocks[index].sectionID === sectionID) return index + 1;
 const sectionIndex = sections.findIndex(section => section.id === sectionID);
 if (sectionIndex >= 0) {
  for (const section of sections.slice(sectionIndex + 1)) {
   const next = blocks.findIndex(block => block.sectionID === section.id);
   if (next >= 0) return next;
  }
 }
 return blocks.length;
}

export function sectionInsertionAnchor(blocks, sections, sectionID, index) {
 const at = Math.max(0, Math.min(blocks.length, Number.isFinite(index) ? index : sectionInsertionIndex(blocks, sections, sectionID)));
 const before = blocks[at], after = blocks[at - 1];
 return {sectionID, beforeID: before?.sectionID === sectionID ? before.id : null, afterID: after?.sectionID === sectionID ? after.id : null};
}
