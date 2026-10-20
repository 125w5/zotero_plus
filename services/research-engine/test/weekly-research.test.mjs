/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {weeklyResearchEntries,weeklyPresentation} from '../../../chrome/content/zotero/research/shared/weekly-research.mjs';
import {THEMES} from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
import {renderStudioDeck} from '../src/studio-render.mjs';
test('weekly records export to a real editable PPTX with source notes and no invented results',async()=>{
 const now=Date.UTC(2026,9,20,12),report=weeklyResearchEntries({researchActivity:[{id:'read-a',title:'量子实验论文',text:'阅读方法章节，尚未开展实验。',at:'2026-10-19T10:00:00Z',uri:'zotero://select/library/items/ABCDEFGH',paperItemID:1}]},[{id:2,kind:'note',title:'下周计划',text:'准备复现基线，尚无实验结果。',dateModified:'2026-10-19 11:00:00',uri:'zotero://note/2'}],{now}),content=weeklyPresentation(report),directory=await fs.mkdtemp(path.join(os.tmpdir(),'easysch-weekly-'));
 const result=await renderStudioDeck({plan:{version:3,title:'本周研究进展',theme:THEMES.light,slides:content.slides},evidence:content.sources,assets:[],directory}),zip=await JSZip.loadAsync(await fs.readFile(result.path));assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length,2);const text=(await Promise.all([1,2].map(index=>zip.file('ppt/slides/slide'+index+'.xml').async('string')))).join('\n'),notes=(await Promise.all([1,2].map(index=>zip.file('ppt/notesSlides/notesSlide'+index+'.xml').async('string')))).join('\n');assert.match(text,/尚未开展实验/);assert.match(text,/尚无实验结果/);assert.match(notes,/zotero:\/\/select\/library\/items\/ABCDEFGH/);assert.match(text,/<p:sp>/);
});
