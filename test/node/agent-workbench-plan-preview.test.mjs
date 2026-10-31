/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=path=>readFile(new URL('../../chrome/content/zotero/'+path,import.meta.url),'utf8');

test('plan preview puts the plan inside the padded, scrollable preview body like source previews',async()=>{
 const ui={},node=(tag,text='',className='')=>({tag,textContent:text,className,children:[],append(...rows){this.children.push(...rows);}});
 vm.runInContext(await source('research/ui/agent-workbench.js'),vm.createContext({EasySchUI:ui,clearTimeout,setTimeout}));
 ui.el=node;ui.agentPreview=node('aside');ui.resetAgentPreview=()=>{ui.agentPreview.children=[];};
 ui.E={notebook:{state:()=>({versions:[{id:'v1',number:1}]}),planMarkdown:()=>'受控实验计划，非实验结果。'},renderContent:(host,text)=>{host.textContent=text;}};
 await ui.showAgentPlan('p','v1');
 const [header,body]=ui.agentPreview.children;
 assert.equal(ui.agentPreview.children.length,2);
 assert.equal(header.className,'agent-preview-header');
 assert.equal(body.className,'agent-preview-body');
 assert.equal(body.children.length,1);
 assert.equal(body.children[0].className,'agent-preview-content');
 assert.equal(body.children[0].textContent,'受控实验计划，非实验结果。');
 assert.equal(ui.agentPreviewBody,undefined);
});

test('execution permission uses a Chinese label distinct from the automatic task mode and keeps the stored value',async()=>{
 for(const path of ['research/ui/agent-workbench.js','xpcom/research/sidebar.js']){
  const text=await source(path);
  assert.match(text,/\[\['auto','直接执行'\],\['ask','询问'\]\]/,path);
  assert.doesNotMatch(text,/\['auto','Auto'\]/,path);
  assert.doesNotMatch(text,/title='Auto /,path);
 }
});
