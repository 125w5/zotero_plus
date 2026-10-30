/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let Presentation=await import(new URL('../../chrome/content/zotero/research/shared/annotation-presentation.mjs',import.meta.url));
let edited=(annotation,value)=>{let shown=Presentation.annotationPresentation(annotation);assert.equal(typeof Presentation.editedAnnotationComment,'function','the margin editor has a save helper');return Presentation.editedAnnotationComment(shown,value);};

test('editing a machine-translation margin comment keeps its 机器翻译（请核对） header',()=>{
 // saveReaderNote writes label + '（请核对）\n' + summary, where summary starts with a newline.
 let annotation={comment:'机器翻译（请核对）\n\n中文译文。',tags:[{name:'机器翻译'}]};
 assert.equal(Presentation.annotationPresentation(annotation).text,'中文译文。','the card still shows only the translation');
 assert.equal(edited(annotation,'中文译文。'),annotation.comment,'an unchanged save stores the exact original comment');
 assert.equal(edited(annotation,'修订后的中文译文。'),'机器翻译（请核对）\n\n修订后的中文译文。','an edited translation keeps the verify label');
 assert.equal(edited(annotation,''),'','clearing the comment removes it entirely');
 let legacy={comment:'机器翻译（请核对）\n选段译文\n链路调度降低了平均信息年龄。',tags:[{name:'机器翻译'}]};
 assert.equal(edited(legacy,'链路调度降低了信息年龄。'),'机器翻译（请核对）\n选段译文\n链路调度降低了信息年龄。');
});

test('a human comment is stored exactly as typed',()=>{
 let annotation={comment:'机器翻译（请核对）\n这一标签会挡住阅读。',tags:[]};
 assert.equal(edited(annotation,'改写后的人工批注'),'改写后的人工批注');assert.equal(edited({comment:'',tags:[]},'新的批注'),'新的批注');
});

test('the margin editor saves through the header-preserving helper',()=>{
 let source=fs.readFileSync(new URL('../../chrome/content/zotero/research/shared/reader-margin-comments.mjs',import.meta.url),'utf8');
 assert.match(source,/comment:editedAnnotationComment\(shown,input\.value\)/);assert.doesNotMatch(source,/comment:input\.value/);
});
