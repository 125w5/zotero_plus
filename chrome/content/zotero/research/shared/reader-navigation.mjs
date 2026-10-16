/* SPDX-License-Identifier: AGPL-3.0-or-later */

// Pane IDs from ItemPaneManager contain the registering plugin ID. Keep the
// ordering policy independent of registration time and of a previous tab.
const researchKinds = ['overview', 'abstract', 'images', 'references', 'workstation'];
export const metadataPaneIDs = ['libraries-collections', 'tags', 'related'];
export const paperHiddenPaneIDs = ['abstract', 'attachment-info', 'attachments'];

export function researchPaneKind(id) {
 return researchKinds.find(kind => String(id).includes(`research-${kind}`)) || null;
}

// Callers may use a short public ID; ItemPaneManager prefixes registered IDs.
export function resolvePaperPaneID(ids, id) {
 const kind = id === 'info' ? 'overview' : id === 'abstract' ? 'abstract' : researchPaneKind(id);
 if (kind) return ids.find(value => researchPaneKind(value) === kind) || null;
 return ids.includes(id) ? id : null;
}

export function paperPaneOrder(ids) {
 const find = kind => ids.find(id => researchPaneKind(id) === kind);
 const primary = [find('overview'), find('abstract'), 'abstract', 'info', 'attachments', 'notes',
  'attachment-info', 'attachment-annotations', 'note-info',
  find('images'), find('references'), find('workstation')];
 const ordered = primary.filter(id => id && ids.includes(id));
 return [...new Set([...ordered, ...ids.filter(id => !metadataPaneIDs.includes(id)),
  ...metadataPaneIDs.filter(id => ids.includes(id))])];
}

export function paperRailOrder(ids, contextNotes = false) {
 const find = kind => ids.find(id => researchPaneKind(id) === kind);
 const primary = [find('abstract'), 'info', contextNotes ? 'context-notes' : 'notes',
  find('images'), find('references'), find('workstation')];
 return [...new Set([...primary.filter(Boolean), ...ids])];
}

export function paperRailPaneVisible(id, contextNotes = false) {
 return !metadataPaneIDs.includes(id) && !paperHiddenPaneIDs.includes(id) && researchPaneKind(id) !== 'overview'
  && !(contextNotes && id === 'notes');
}
