/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {activeReaderForAttachment} from '../../chrome/content/zotero/research/shared/active-reader.mjs';
test('saving a note targets the visible duplicate instead of the first restored reader',()=>{
 const first={Zotero_Tabs:{selectedID:'library'}},current={Zotero_Tabs:{selectedID:'reader-current'}};
 const old={itemID:1,tabID:'reader-old',_window:first},visible={itemID:1,tabID:'reader-current',_window:current};
 assert.strictEqual(activeReaderForAttachment([old,visible],1,current),visible);
 current.Zotero_Tabs.selectedID='library';assert.strictEqual(activeReaderForAttachment([old,visible],1,current),visible);
});
test('closed, unloaded and other-paper readers cannot receive a saved note',()=>{
 const win={Zotero_Tabs:{selectedID:'current'}},good={itemID:1,_window:win,tabID:'current'};
 const rows=[{...good,_window:{closed:true}},{...good,_isTabClosed:true},{...good,_isUninitialized:true},{...good,itemID:2},{itemID:1},good];
 assert.strictEqual(activeReaderForAttachment(rows,1,win),good);assert.strictEqual(activeReaderForAttachment(rows.slice(0,-1),1,win),undefined);
});
