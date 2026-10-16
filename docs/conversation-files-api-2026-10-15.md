# Conversation files and spreadsheet evidence

Files remain existing Zotero attachments, images or complete material records. A
conversation stores references and its own choices; there is no second binary
file database. Removing an association leaves the actual library file intact.

## Shared UI API

`Zotero.Research.chatAttachments` exposes:

- `get(sessionID)` → reference array. Existing identity fields remain. Every
  reference has `selected` (default true), `featured` (default false). Optional
  spreadsheet fields are `sheet` and `ranges` (`['B2:F40']`).
- `selected(sessionID, {featuredOnly:false})` → selected references. Featuring
  a file does not silently remove ordinary selected files from the next answer.
- `setState(sessionID, referenceID, {selected, featured, sheet, ranges})` → new
  reference array. Changes are serialized through the shared conversation store.
- `preview(sessionID, referenceID, {signal, sheet, ranges})` →
  `{reference, kind, rows, warnings, workbook?}`. This reads actual content without
  opening a reader. Unselected files may be inspected; inspection does not select
  them for a question. A deleted reference or selection changed during the read
  rejects its stale preview.
- `readSession(sessionID, {signal, query, images})` →
  `{rows, images, warnings}` for model input. Only this conversation's selected
  files are read. Removal or selection changes while reading reject the result.
- Existing `read(references, {signal, query, images, sessionID})` remains supported.
  Pass `sessionID` to validate ownership and reject stale selections. Old callers
  without it still honor `selected:false`, but cannot verify session ownership.

Identity refreshes and duplicate imports preserve selection and featured state.
Generic stale conversation updates cannot overwrite those choices or restore
detached files. Explicit reattachment restores an association. Copying a file to
another conversation creates an independently selected, unfeatured reference.
PPT draft scopes use `ppt:<pptDraftID>` so two drafts in a project keep separate
conversation files.

## Spreadsheet data

XLSX, XLS and CSV import into the ordinary Zotero attachment store. They are
parsed by `assets-chat-spreadsheet` through the installed asset Python, with
`openpyxl==3.1.5`, `xlrd==2.0.1`, and Python's CSV parser. Excel/LibreOffice are not
started. XLSX formulas are retained as literal formulas, external links are not
read, and macros are not executed. XLS exposes saved cell values; a warning
states that formula results may be from the last save.

Each workbook preview includes:

```js
{
  version, hash, // parser version and SHA-256 of actual file bytes
  sheets: [{name, rows, columns, hidden}], selectedSheet,
  range, cells: [{row, values}], // first selected region, for simple previews
  sections: [{range, startColumn, endColumn, cells, formulaCells}],
  truncated, warnings
}
```

CSV has the stable sheet label `CSV`, not Zotero's internal stored filename.
Chinese CSV supports UTF-8/BOM and an explicitly disclosed GB18030 fallback.
The default is the first visible worksheet's first 100 rows and 30 columns.
Users can select up to 3 regions, 200 rows/60 columns per region, 6000 cells total.
Limits also cover input size (12 MB), inflated XLSX size (80 MB), worksheet count,
cell length, and aggregate text. Partial coverage is disclosed. Evidence contains
actual quoted cell values with worksheet/cell addresses and the file hash; model
input is bounded separately and reports omitted portions. Parser results are
cached by current bytes plus sheet/ranges, so changing a file invalidates them.

## Verification

Focused Node suites cover existing academic/workbench send flows, conversation
selection persistence and stale detach protection, real CSV import through the
native adapter's controlled Zotero import, real Python engine parsing, selected
ranges, file-byte changes, and evidence cell locations. Python tests additionally
generate real XLSX/CSV files and read a small real legacy XLS fixture. The native
`Shared research chat attachments` suite includes the actual CSV IPC/import/read
case, to be run with the current build. These tests do not imply live model
connectivity or real provider reasoning quality.
