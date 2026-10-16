/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Global-library notifications refresh a view. They do not add unselected
// assets to a manuscript's saved catalog or require another manuscript save.
export function referencedAssetsChanged(project, assets) {
 return (project.materials || []).some(material => {
  const current = assets[material.assetID];
  return current && current.revision !== material.revision;
 });
}

export function rememberAssetViewDefaults(project, previousIDs, defaults) {
 const included = new Set((project.materials || []).map(material => material.id));
 for (const [id, entry] of Object.entries(project.materialCatalog?.entries || {})) {
  if (!previousIDs.has(id) && !included.has(id) && !defaults.has(id)) {
   defaults.set(id, JSON.stringify(entry));
  }
 }
}

export function assetViewProjectSnapshot(project, defaults, clone = value => JSON.parse(JSON.stringify(value))) {
 const value = clone(project);
 const included = new Set((project.materials || []).map(material => material.id));
 for (const order of Object.values(project.materialCatalog?.orders || {})) {
  for (const id of order) included.add(id);
 }
 for (const [id, initial] of defaults) {
  const entry = project.materialCatalog?.entries?.[id];
  // An explicit insertion, manual order or catalog edit promotes the entry into the saved
  // project. Untouched display defaults remain available in the live view.
  if (!included.has(id) && entry && JSON.stringify(entry) === initial) {
   delete value.materialCatalog.entries[id];
  }
 }
 return value;
}
