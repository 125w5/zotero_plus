# Source-paper data verification

The source fixture is Alzubaidi et al., “Review of deep learning: concepts, CNN architectures, challenges, applications, future directions,” Journal of Big Data 8, 53 (2021), DOI `10.1186/s40537-021-00444-8`, CC BY 4.0.

Actual local PDF extraction now retains all 30 printed figures and 5 tables across 74 pages. The original text-cache bibliography contains 343 numbered references; the revised parser returns every consecutive entry, including the lowercase `de Vos` author at entry 322. Repeated source page headers and Publisher’s Note are excluded. Captions without punctuation after their figure number no longer disappear. The asset extraction cache version is `mupdf-assets-16`; reference resolution cache version is `resolved-refs-v4`.

The overview keeps the paper title and populated native metadata before the Chinese abstract excerpt. The excerpt translates actual complete source sentences; it does not ask a model to invent a summary. Full abstracts retain English above Chinese. Task reuse and request sequencing prevent duplicate translation submissions and old responses from replacing a newer paper. IF is displayed only when the actual metric provider has supplied a finite value.

Standalone PDFs can gain a bibliographic parent only when a unique front-matter DOI, exact provider DOI and matching front-matter title identify the paper. Missing native fields and creators are completed; existing user edits are preserved. Parent creation/reuse runs inside a native transaction and rechecks concurrent imports. Attachment paths, keys, annotations and collection memberships remain intact. Provider mismatches, ambiguous records, read-only libraries and temporary failures do not migrate the document. All metadata requests in the regression suite are controlled fixtures; no real provider/model request or daily-library migration was performed for this verification.

Verification completed:

- Node: `node --test test/node/paper-metadata.test.mjs test/node/pdf-bibliography-real.test.mjs test/node/paper-overview-data.test.mjs services/research-engine/test/reference-matcher.test.mjs services/research-engine/test/academic-shared-conversation.test.mjs` — 43 tests after the concurrent-import case, all passing.
- Python: `E:/workspace/zotero-main/.tools/pdf-assets-env/Scripts/python.exe -X utf8 -m unittest test_assets.py` in `services/research-engine/pdf` — 43 passing.
- Actual physical PDF: full asset indexing in a temporary cache returned 74 pages, 30 figures and 5 tables. Fig. 1, 2, 3 and 30 were inspected against the source pages. The source frame surrounds the caption; crops intentionally exclude that caption while retaining complete research graphics.
- Source-text, PDF metadata and caption-coordinate fixtures are saved in `test/node/fixtures/deep-learning-review-*` with source provenance.
- New native suite `researchSourcePaperDataTest.js` reads the actual source cache and runs the actual PDF artifact engine without requesting a model or provider. Native execution is pending the parent task’s build and isolated-profile acceptance.

QA crop artifacts: `E:/workspace/zotero-main/.tools/readonly-review-assets-qa/Fig-1.png`, `Fig-2.png`, `Fig-3.png`, `Fig-30.png`; page 5, 7 and 51 images are stored beside them for comparison.
