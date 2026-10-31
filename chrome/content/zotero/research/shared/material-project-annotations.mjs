/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Assembly comments belong to the current manuscript until explicitly applied
// to its source PDF. A shared source asset can be used by many manuscripts.
const copy=value=>JSON.parse(JSON.stringify(value));
export function saveProjectMaterialHighlights(project,material,highlights){
 project.materials||=[];let local=project.materials.find(row=>row.id===material.id);
 // A full-text hit (findPaperPassages) has no revision; its project copy starts
 // at the first version, as a new material does, since every project material
 // needs one (M.assertProject). Highlights count in annotationRevision.
 if(!local){local=copy(material);if(!Number.isInteger(local.revision))local.revision=1;project.materials.push(local);}
 local.projectAnnotationProjectID=project.id;local.projectHighlights=copy(highlights);local.highlights=copy(highlights);local.annotationRevision=(local.annotationRevision||0)+1;
 return local;
}
export function mergeMaterialAsset(material,asset){
 const local=material.projectAnnotationProjectID?{projectAnnotationProjectID:material.projectAnnotationProjectID,projectHighlights:copy(material.projectHighlights||material.highlights||[]),annotationRevision:material.annotationRevision||0}:null;
 Object.assign(material,copy(asset));if(local)Object.assign(material,local,{highlights:copy(local.projectHighlights)});return material;
}
