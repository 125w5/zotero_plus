# PPT and academic graphics integration — 2026-09-05

## Current implementation

Native meeting workspace → DSH assembled planning prompt → configured remote model (DeepSeek retained) → reviewed page plan → DSH validation/export tools → editable PPTX + SVG/draw.io + evidence/data manifest.

The engine is in `services/research-engine`; the Gecko bridge is `xpcom/research/artifacts.js`. The built-in Word, PDF reader and plugin mechanisms are unchanged. An earlier native regression reported 9/9, but it did not exercise the PDF inline actions, DOCX center viewer, tag study sets, or visual slide previews and must not be used as acceptance evidence for those features. The artifact engine currently has two passing tests that inspect editable PPTX diagram/chart internals. The new native UI assertions require a complete platform test runtime before they can be reported as passing.

## Upstream reuse status (do not report all projects as installed)

| Source | Applied now | Not yet integrated |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Actual Cordis, system-prompt and tool-registry packages | Agent loop, MCP/plugin installation UI, durable DSH session engine |
| [PPTAgent / DeepPresenter](https://github.com/icip-cas/PPTAgent) | Separate planning/editable export/verification stages in our design | Python runtime; official README directs Windows users to WSL |
| [Auto-Slides](https://github.com/Westlake-AGI-Lab/Auto-Slides) | Paper-focused narrative requirements | Its full multi-agent implementation |
| [AutoPresent](https://github.com/para-lost/AutoPresent) | Editable programmatic slides rather than full-page images | Dedicated trained model; no weights downloaded |
| [PaperBanana](https://github.com/dwzhu-pku/PaperBanana) | Separation of content planning from image generation | Retriever, style agent, image provider and visual critique |
| [AutoFigure](https://github.com/ResearAI/AutoFigure), [DiagrammerGPT](https://diagrammergpt.github.io/) | Structured entities/relations and editable diagram output | Their agent/model runtime and reference matching |
| [MatPlotAgent](https://github.com/thunlp/MatPlotAgent) | Real data requirement and explicit validation stage | Arbitrary generated plotting-code execution / visual model loop |
| [Presenton](https://github.com/presenton/presenton) | Considered export/editor separation | Its web editor/server |

These design references are not claims of copied source modules. Only the DSH packages and PptxGenJS are runtime dependencies in this increment. Additional suggested benchmark/model projects remain to be evaluated.

## Remaining product work

Automatic rendering of every user export, geometric/visual checks and repair loop; raster illustration API; original PDF figure extraction; richer reference templates; statistical plotting with units/error bars; visual source support; substantive claim verification beyond source-ID checks. Text-only DeepSeek planning cannot substitute for visual inspection. Existing source locators may identify an attachment rather than an exact page; no page number is invented.
