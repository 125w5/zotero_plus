import test from 'node:test';
import assert from 'node:assert/strict';
import {academicExcerpts,bindAcademicQuotes} from '../../../chrome/content/zotero/research/shared/academic-evidence.mjs';
test('academic evidence preserves PDF ligatures and line breaks, sampling each source',()=>{
 const sources=[{id:'paper',text:'The model conﬁguration\nuses '.repeat(80)},{id:'annotation',text:'用户批注：需验证泄漏风险。'}],q=academicExcerpts(sources,1500);assert.equal(q[1].source_id,'annotation');assert.ok(q.every(x=>x.text.length<=700&&sources.find(s=>s.id===x.source_id).text.includes(x.text)));
 const result=JSON.parse(bindAcademicQuotes(JSON.stringify({sections:[{body:'需核验',quoteIDs:[q[0].id,q[1].id]}]}),q));assert.deepEqual(result.sections[0].sources,['paper','annotation']);assert.equal(result.sections[0].quotes[0].text,q[0].text);
});
test('unknown and missing quote IDs fail rather than laundering model quotations',()=>{
 assert.throws(()=>bindAcademicQuotes('{"sections":[{"quoteIDs":["Q404"]}]}',[]),/不存在/);assert.throws(()=>bindAcademicQuotes('{"sections":[{"quotes":[{"text":"invented"}]}]}',[]),/编号/);
});
