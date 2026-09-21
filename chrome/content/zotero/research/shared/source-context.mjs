/* Adapted from Open Notebook frontend/src/lib/utils/source-context.ts.
 * Copyright (c) 2024 Luis Novo. MIT; see third-party/academic-workflows/LICENSE-open-notebook.
 * Type annotations removed for Zotero's native ES modules. */
export function includedMode(insightsCount) { return insightsCount > 0 ? 'insights' : 'full'; }
export function bulkModeForSource(mode, insightsCount) {
  switch (mode) {
    case 'exclude': return 'off';
    case 'full': return 'full';
    case 'insights': return insightsCount > 0 ? 'insights' : 'off';
    default: return includedMode(insightsCount);
  }
}
export function computeSourceSelections(existing, sources, defaultMode = 'include') {
  const next = {...existing};
  for (const source of sources) {
    const current = next[source.id];
    if (current === undefined) next[source.id] = bulkModeForSource(defaultMode, source.insights_count);
    else if (defaultMode === 'include' && current === 'full' && source.insights_count > 0) next[source.id] = 'insights';
  }
  return next;
}
export function applyBulkSourceContext(existing, sources, action) {
  const next = {...existing};
  for (const source of sources) next[source.id] = bulkModeForSource(action, source.insights_count);
  return next;
}
