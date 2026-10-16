/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseReferenceText} from '../../chrome/content/zotero/research/shared/reference-matcher.mjs';
test('real Springer PDF cache splits all 343 consecutive references despite inline numbering',async()=>{
 const source=await readFile(new URL('./fixtures/deep-learning-review-bibliography.txt',import.meta.url),'utf8'),refs=parseReferenceText(source);
 assert.equal(refs.length,343);assert.deepEqual(refs.map(ref=>Number(ref.id)),Array.from({length:343},(_,i)=>i+1));
 assert.match(refs[0].quote,/Rozenwald/);assert.match(refs.at(-1).quote,/Assemblynet/);assert.match(refs[321].quote,/de Vos/);
 assert.ok(refs.every(ref=>ref.quote.length<1000));assert.ok(refs.every(ref=>!/(?:Page \d+ of \d+|Publisher[’']s Note|Alzubaidi et al\. J Big Data)/.test(ref.quote)));
});
test('volume numbers, decimal results and years stay within their actual reference',()=>{
 const refs=parseReferenceText('References\n1. Smith A. First title. Vol. 1. IEEE Press. 2021. Accuracy 95.6%. 2. Jones B. Second title. Vol. 2. IEEE Press. 2020. 3. de Vos J. Last real title. 2019.\nPublisher’s Note\nMust not enter a reference.');
 assert.deepEqual(refs.map(ref=>ref.id),['1','2','3']);assert.match(refs[0].quote,/Vol\. 1\. IEEE/);assert.match(refs[1].quote,/Vol\. 2\. IEEE/);assert.match(refs[0].quote,/95\.6%/);assert.doesNotMatch(refs.at(-1).quote,/Publisher|Must not/);
});
test('bracket references and Chinese numbered references retain their original source content',()=>{
 assert.equal(parseReferenceText('REFERENCES\n[1] Smith A. Actual title. 2020.\n[2] Liu B. Another title. 2021.').length,2);
 assert.equal(parseReferenceText('参考文献\n1. 王，自动调制识别的研究方法，2024。\n2. 张，卷积神经网络在识别中的应用，2023。').length,2);
 assert.equal(parseReferenceText('An introduction cites [1] and discusses vol. 1. IEEE papers.' ).length,0);
});
