/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../../chrome/content/zotero/research/ui/reading-workbench.js',import.meta.url),'utf8');
function fixture({library=false}={}){
 const calls=[],nativeWindow={id:'daily-library'},navigation={remove(){calls.push(['remove-reading-nav']);}},log={},input={value:'保留的草稿'},selected={id:31,kind:'paper'};
 const ui={agentMessages:log,agentInput:input,agentSelected:selected,agentSourceList:{},agentHomeList:{},show(tab){this.activeView=tab;calls.push(['show',tab]);},status(error){throw Error(error);},openAgentWorkbench(){this.activeView='agent';},E:{async openLibraryReading(win){assert.strictEqual(win,nativeWindow);calls.push(['local']);return win;},async openLibraryWorkspace(win,mode){assert.strictEqual(win,nativeWindow);calls.push(['library',mode]);return{mode};}}};
 const window={parent:{Zotero:{getMainWindow:()=>nativeWindow}},frameElement:library?{researchLibraryMode:true}:{},addEventListener(){}};
 const document={querySelector:selector=>{assert.equal(selector,'.rail [data-tab=research]');return navigation;}};
 vm.runInNewContext(source,{EasySchUI:ui,window,document});ui.initReadingWorkbench();return{ui,calls,log,input,selected};
}
test('legacy reading navigation returns to the existing library without embedding or replacing conversation state',async()=>{
 const f=fixture();await f.ui.show('research');assert.deepEqual(f.calls,[['remove-reading-nav'],['local']]);assert.strictEqual(f.ui.agentMessages,f.log);assert.strictEqual(f.ui.agentInput,f.input);assert.strictEqual(f.ui.agentSelected,f.selected);assert.equal(f.ui.renderAgentPreviewPane,undefined);
});
test('workbench home and search share native discovery while other workflow pages remain local',async()=>{
 const f=fixture();await f.ui.show('home');await f.ui.show('search');f.ui.show('writing');assert.deepEqual(f.calls,[['remove-reading-nav'],['library','discovery'],['library','discovery'],['show','writing']]);
});
test('native discovery keeps its existing home and redirects an explicit conversation into the shared workspace',async()=>{
 const f=fixture({library:true});let drafts=0;const conversation={agentInput:{value:''},updateAgentDraft(){drafts++;}};
 f.ui.E.openResearchAgent=async()=>{f.calls.push(['conversation']);return conversation;};f.ui.show('home');assert.equal(f.ui.activeView,'home');const result=await f.ui.openAgentWorkbench('解释这个方法');assert.strictEqual(result,conversation);assert.equal(conversation.agentInput.value,'解释这个方法');assert.equal(drafts,1);assert.equal(f.ui.activeView,'home','不在推荐 iframe 内展开第二个工作台');
});
