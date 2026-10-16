/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Native research note editor notification lifecycle', function () {
 it('discards an awaited update after the note editor switches and still updates the current instance', async function () {
  const win = await loadZoteroPane();
  const editor = win.document.createXULElement('note-editor');
  const first = new Zotero.Item('note'), second = new Zotero.Item('note');
  first.setNote('<p>Original note</p>');second.setNote('<p>Current note</p>');
  await first.saveTx();await second.saveTx();
  let release, started = false, oldUpdates = 0, newUpdates = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const oldInstance = { instanceID:'old', notify:async()=>{started=true;await pending;}, applyIncrementalUpdate:()=>oldUpdates++ };
  const newInstance = { instanceID:'new', notify:async()=>{}, applyIncrementalUpdate:()=>newUpdates++ };
  try {
   editor._item=first;editor._editorInstance=oldInstance;
   const notification=editor.notify('modify','item',[first.id],{[first.id]:{state:{},noteEditorID:'external'}});
   assert.isTrue(started);editor._item=second;editor._editorInstance=null;release();await notification;
   assert.equal(oldUpdates,0,'A retired instance receives no old-note update');
   editor._editorInstance=newInstance;editor._lastHtmlValue='';
   await editor.notify('modify','item',[second.id],{[second.id]:{state:{},noteEditorID:'external'}});
   assert.equal(newUpdates,1,'Current note still receives its incremental update');
   editor._editorInstance=null;
   await editor.notify('modify','item',[second.id],{});
   assert.equal(newUpdates,1,'A loading editor tolerates a notification without a live instance');
  } finally { release();editor._item=null;editor._editorInstance=null;await first.eraseTx();await second.eraseTx();win.close(); }
 });
});
