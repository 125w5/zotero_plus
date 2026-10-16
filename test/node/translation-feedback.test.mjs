/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {translationFailure} from '../../chrome/content/zotero/research/shared/translation-feedback.mjs';

test('translation feedback preserves the exact diagnostic while presenting one actionable failure',()=>{
 const reason='快速机翻失败：译文改变或遗漏数学关系：~N；GPT-6 Luna后备失败：译文改变或遗漏数学关系：~N，请重试',result=translationFailure(Error(reason));
 assert.equal(result.kind,'quality');assert.equal(result.reason,reason);assert.equal(result.title,'译文未通过核对');assert.ok(!result.message.includes('GPT-6'));assert.match(result.message,/重试/);
});
test('translation feedback distinguishes cancellation, deadline, configuration and connection failures',()=>{
 for(const [error,kind] of [[Object.assign(Error('service cancelled'),{name:'AbortError'}),'cancelled'],[Object.assign(Error('deadline expired'),{name:'TimeoutError'}),'timeout'],[Error('机器翻译暂不可用'),'configuration'],[Error('无法连接服务，请检查网络或代理'),'connection'],[Error('翻译服务未返回译文'),'error']])assert.equal(translationFailure(error).kind,kind);
});
