import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationPresentation} from '../../chrome/content/zotero/research/shared/annotation-presentation.mjs';
test('legacy generated translations are quiet without rewriting stored comments',()=>{
 const annotation={comment:'机器翻译（请核对）\n选段译文\n链路调度降低了平均信息年龄。',tags:[{name:'机器翻译'}],color:'#a28ae5'};
 const shown=annotationPresentation(annotation);
 assert.equal(shown.text,'链路调度降低了平均信息年龄。');assert.equal(shown.translation,true);assert.equal(shown.color,annotation.color);assert.match(annotation.comment,/请核对/);
});
test('human commentary is preserved even when it discusses a translation label',()=>{
 const annotation={comment:'机器翻译（请核对）\n这一标签会挡住阅读。',tags:[],color:'#ffd400'};
 assert.equal(annotationPresentation(annotation).text,annotation.comment);
});
