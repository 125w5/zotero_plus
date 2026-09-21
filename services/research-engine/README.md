# EasySch research artifact engine

This is a headless application dependency, not a second desktop or web app. Node executes deterministic artifact tools; model inference stays at the configured remote API. Credentials remain in Zotero's login manager and never reach this process.

## Implemented

- Actual DSH `SystemPrompt` assembly and `ToolRegistry` execution, pinned in package-lock.json.
- Domain tools `validate_research_plan` and `export_research_deck`. No shell/editor/code runtime plugins.
- Native editable PPTX text, diagrams, charts with embedded XLSX data; SVG and draw.io diagram companions.
- Evidence IDs checked against the source record; source hyperlinks and source text in speaker notes.
- A unique export directory containing plan, evidence, datasets and manifest. Existing files are not replaced.
- DeepSeek page planning called from Zotero, editable plan preview, optional user dataset import.

Setup: `scripts/setup-research-engine.ps1` from the repository root, then the normal research launcher. Dependencies are separate from Zotero's frontend dependencies. Production packaging must include this service and a Node runtime; current source launcher resolves the installed Node executable.

## Dataset input

Import CSV/XLSX through the native file picker (requires the paper-assets Python environment), or a JSON array. These numbers demonstrate the format only, not research results:

```json
[{"id":"my-experiment","provenance":"Describe the actual file, experiment and measurement source","labels":["A","B"],"series":[{"name":"Example only","values":[2,3]}]}]
```

The model selects `datasetID` and chart type, never numerical values. Dataset provenance is user supplied, not independently verified. Bar, categorical line, numeric-X scatter and editable heatmap tables are implemented. Statistical tests and uncertainty intervals are not yet implemented. CSV/XLSX input is limited to 30 rows and five numeric series; formulas and missing values are rejected.

## Verification and boundaries

`npm test --prefix services/research-engine` checks real DSH dispatch, prohibited tools, invalid evidence/relationships/numbers, editable OOXML, embedded workbooks, source links, ELK layouts and draft undo/redo. Native tests additionally exercise all four PPT entrances, the six-step creation flow, X6 editing, closing/reopening the draft, and per-page rendering. The optional `-LivePPT` launcher flag verifies the configured remote model separately.

Configured exports now run LibreOffice headless, convert every page to PNG with Poppler, and inspect PDF text geometry and image ink coverage. The workspace displays these actual rendered pages separately from its draft layout. Reports flag blank pages, text beyond the page, small text and suspected text overlap. These mechanical checks do not establish graphical occlusion, scientific correctness or visual quality; `human_review_required` remains explicit. No vision model or raster image provider is configured.

The source launcher discovers `.tools/libreoffice/program/soffice.exe` and `.tools/poppler/Library/bin/pdftoppm.exe` in the parent workspace. Override the native `extensions.easysch.soffice` and `extensions.easysch.poppler` preferences for other installations. Renderer binaries are external dependencies, not stored in Git. For engine render tests set `EASYSCH_TEST_SOFFICE` and `EASYSCH_TEST_PDFTOPPM`. Unconfigured render integration is optional; validation and editable export tests still run.

The service does not execute the full DSH agent loop or upstream PPTAgent/PaperBanana pipelines. Prompt composition and deterministic tool execution are the actual DSH integration boundary in this version. The planner is an EasySch prompt informed by those workflow designs, not their trained model.

## Dependency notes

Installed DSH package metadata licenses differ from the repository-wide license: dsh-tools and dsh-system-prompt declare BSD-3-Clause; Cordis and PptxGenJS declare MIT. Preserve distributed license notices.

At installation, npm reported two high-severity advisory entries through PptxGenJS's image-size dependency (ICNS/JXL/HEIF parser loops). Image input is restricted to validated canonical PNG assets: signature, dimensions, decoded content and size are checked before PptxGenJS sees them. Unsupported ICNS/JXL/HEIF files and model-supplied asset paths are not accepted. PPTX theme import reads bounded OOXML without rendering embedded media or executing document code. Keep these checks when extending input.

## Paper assets

Use scripts/setup-paper-assets.ps1 to install the deterministic PyMuPDF/openpyxl environment. The native Reader offers figure candidates, source navigation, protected manual crops and confirmed PPT selection. SQLite caches bind PDF hashes and extractor versions; AI caches additionally bind endpoint, model and prompt/schema. The PPT studio renders one-page requests, so editing one page does not require another AI call or rendering for other pages. Final deck export assembles the current pages.

## Native PPT studio

Version 3 plans separate seven content templates from four built-in visual themes and an imported PPTX theme. AUTO proposes an outline, waits for confirmation, then generates evidence-checked text, notes and semantic diagrams through the configured DeepSeek-compatible API. X6 is the in-tab editor; ELK positions nodes and routes edges. SVG/draw.io companions and native PowerPoint shapes are generated from the same semantic diagram.

Run `npm ci --prefix services/research-engine` before `scripts/build-native.ps1`; the native build bundles X6/ELK using `npm run build:browser`. No local AI weights are installed. Sources are in `src/studio-*.mjs`, with Zotero state and UI in `chrome/content/zotero/{xpcom/research/ppt-studio*.js,research/ui/ppt-*.js}`.

PPTX import currently extracts theme colors, fonts and supported title slots, not arbitrary master artwork/animations. The editor provides forms, page reordering and a graph canvas, not the complete PPTist object editor. Mathematical expressions remain text or original PDF formula assets; general native Office equation authoring is not implemented.
