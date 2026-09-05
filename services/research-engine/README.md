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

Import a JSON array. These numbers demonstrate the format only, not research results:

```json
[{"id":"my-experiment","provenance":"Describe the actual file, experiment and measurement source","labels":["A","B"],"series":[{"name":"Example only","values":[2,3]}]}]
```

The model selects `datasetID` and chart type, never numerical values. Dataset provenance is user supplied, not independently verified. Bar and categorical line charts are implemented; statistical tests, continuous numeric axes and uncertainty intervals are not yet implemented.

## Verification and boundaries

`node --test services/research-engine/test/engine.test.mjs` checks real DSH dispatch, prohibited tools, invalid evidence/relationships/numbers, editable OOXML, embedded workbooks and source links. Native test suite additionally exercises the subprocess pipe and remote DeepSeek planner.

Development fixture slides were imported and rendered individually with the supplied artifact renderer. An arrow layout problem found in the first pass was fixed and re-rendered. This development verification is **not** an automatic per-user-export visual review. Manifest `visualReview: pending` deliberately preserves that distinction. No vision model or raster image provider is configured.

The service does not execute the full DSH agent loop or upstream PPTAgent/PaperBanana pipelines. Prompt composition and deterministic tool execution are the actual DSH integration boundary in this version. The planner is an EasySch prompt informed by those workflow designs, not their trained model.

## Dependency notes

Installed DSH package metadata licenses differ from the repository-wide license: dsh-tools and dsh-system-prompt declare BSD-3-Clause; Cordis and PptxGenJS declare MIT. Preserve distributed license notices.

At installation, npm reported two high-severity advisory entries through PptxGenJS's image-size dependency (ICNS/JXL/HEIF parser loops). Registry latest image-size was still 2.0.2. This engine accepts **no images, uploaded PPT templates or model-supplied asset paths** and never calls image parsing APIs. Do not extend image input until the parser is upgraded or isolated with limits. Do not downgrade PptxGenJS to the ancient version suggested by automatic audit fix.
