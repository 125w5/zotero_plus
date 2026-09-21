import test from 'node:test';
import assert from 'node:assert/strict';
import {journalFromDocument} from '../../../chrome/content/zotero/research/shared/journal-context.mjs';
test('explicit submission cover is distinct from publication and references',()=>{
 const doc={paragraphs:[{pageIndex:0,sourceText:'Under review for possible publication in\nJournal:\nIEEE Transactions on Communications\nManuscript ID: 123'},{pageIndex:8,sourceText:'IEEE Transactions on Other Topics'}]};
 assert.deepEqual(journalFromDocument(doc),{journal:'IEEE Transactions on Communications',kind:'submitted',sourceText:'Journal:\nIEEE Transactions on Communications',pageIndex:0});
 assert.equal(journalFromDocument({paragraphs:[{pageIndex:8,sourceText:'Journal:\nIEEE Transactions on Communications'}]}).journal,'');
 assert.equal(journalFromDocument({paragraphs:[{pageIndex:0,sourceText:'arXiv:2401.00001'}]}).kind,'preprint');
});
