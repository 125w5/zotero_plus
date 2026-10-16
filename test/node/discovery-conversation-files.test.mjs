/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile(new URL('../../chrome/content/zotero/research/ui/discovery.js',import.meta.url),'utf8');
function setup(){const attached=[],notices=[],ui={agentData:{activeSessionID:'new-session'},status:(...args)=>notices.push(args),E:{workbenchConversations:{get:id=>id==='old-session'?{id}:null},chatAttachments:{attach:async(...args)=>attached.push(args)}}};vm.runInNewContext(code,{EasySchUI:ui});return {ui,attached,notices};}
test('a finished paper download joins its initiating conversation even if another conversation is now visible',async()=>{
 const {ui,attached}=setup();let redraws=0;ui.renderAgentAttachments=()=>redraws++;
 assert.equal(await ui.linkDiscoveryConversationFile({attachmentID:42},'old-session'),true);assert.equal(attached[0][0],'old-session');assert.deepEqual(Array.from(attached[0][1].items),[42]);assert.equal(redraws,0);
});
test('failure to attach a downloaded PDF preserves the download and explains the conversation limit',async()=>{
 const {ui,notices}=setup();ui.E.chatAttachments.attach=async()=>{throw Error('最多关联12份资料');};assert.equal(await ui.linkDiscoveryConversationFile({attachmentID:42},'old-session'),false);assert.match(notices[0][0],/PDF 已保存在文件夹/);assert.match(notices[0][0],/12份资料/);
});
test('metadata-only results and a removed initiating conversation never attach files to the newly active conversation',async()=>{
 const {ui,attached}=setup();assert.equal(await ui.linkDiscoveryConversationFile({itemID:42},'old-session'),false);assert.equal(await ui.linkDiscoveryConversationFile({attachmentID:42},'removed'),false);assert.equal(attached.length,0);
});
