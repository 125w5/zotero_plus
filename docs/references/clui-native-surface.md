# CLUI CC native surface adaptation

Source: the supplied `cankao/clui-cc-main/clui-cc-main` checkout, MIT,
Copyright (c) 2025-2026 Lucas Couto. Full license is distributed at
`chrome/content/zotero/research/vendor/CLUI-CC-LICENSE.txt`.

`shared/clui-surface.mjs` and `.css` are a native Gecko DOM adaptation of:

- `src/renderer/App.tsx`: always-mounted tab shell, animated conversation
  body and separate input pill; 15 px collapsed inset, −14 px overlap,
  10 px expanded gap; 260 ms `cubic-bezier(0.4, 0, 0.1, 1)` transition.
- `components/ConversationView.tsx`: `groupMessages`, 100-message paging,
  60 px near-bottom scroll tracking, preserving a reader's scroll position.
- `components/InputBar.tsx`: single-line input expanding to a bounded multiline
  input, attachments within the pill, controls associated with that input.
- `src/renderer/index.css`: stacked action buttons with the original
  `right: 0/28/56` to `0/56/112` geometry and hover curve.

The application keeps its own blue-gray tokens and Gecko-compatible service
calls. Electron window dragging, click-through IPC, microphone/Claude-process
integration, React and Zustand are not copied. The action stack stays inside
the footer, keeping adjacent material and detail rails unobstructed.

Project interaction requirements add three states: compact, conversation and
detail. Internal content clicks enlarge; one outside click dims; an outside
double click collapses unless pinned. Focus changes do not close the surface.
PPT connects this shell to the existing draft, conversation, attachments,
material-reading, outline, rendering and export APIs.

## Reader and research workspace refinements (2026-10-19)

The local `components/PopoverLayer.tsx` was also reviewed. Its document-level
layer is outside the clipped glass pill. `shared/conversation-surface.mjs`
now uses that placement pattern for task, permission, model, reasoning and
conversation menus. It retains viewport bounds, keyboard navigation and
outside-click ownership rather than increasing a clipped child's z-index.

The reader initially shows a bottom composer, fades and retracts it after idle,
and restores it when approached. Dragging its handle to either side parks a
small conversation icon without reserving or hiding the original sidebar.
Clicking the icon opens the existing conversation in that side. Transient
drag frames use `requestAnimationFrame` and a transform, without saving state
or measuring every target on each pointer event; backdrop blur pauses during
the drag and returns on release.

The dedicated research conversation page uses the same typography and input
surface in persistent mode. It fills the center workspace and does not add a
second compact/detail card or dim the page when the user clicks elsewhere.
