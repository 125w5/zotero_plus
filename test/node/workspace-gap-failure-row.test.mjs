/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WA-02: a stopped run keeps the writes its finished tools saved; the failure
// row names them and must not claim that nothing was saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function fixture(){
	let ui={},opened=[],node=(tag,text='',className='')=>({tag,textContent:text,className,dataset:{},children:[],append(...rows){this.children.push(...rows);},setAttribute(name,value){this[name]=value;}});
	vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),vm.createContext({EasySchUI:ui,clearTimeout,setTimeout}));
	ui.el=node;ui.E={notebook:{openProject:async id=>{opened.push(id);}}};
	return {ui,opened};
}
let parts=row=>({head:row.children[0].textContent,cause:row.children[1].textContent,buttons:(row.children[2]?.children||[]).map(button=>button.textContent)});

test('a stopped run names the page and material writes that finished and opens their project',async()=>{
	let {ui,opened}=await fixture();
	let row=ui.agentFailureRow({id:'q',role:'user',failure:{kind:'stopped',message:'已停止，本次回答未保存',partial:{projectID:'p1',saved:['已新增 1 页','已加入 2 份素材']}}},true),view=parts(row);
	assert.equal(view.head,'已停止 · 已完成的操作已保留');
	assert.match(view.cause,/已完成：已新增 1 页、已加入 2 份素材/);
	assert.match(view.cause,/重试会重新执行整个请求/);
	assert.doesNotMatch(view.head+view.cause,/未保存|未生成/);
	assert.ok(view.buttons.includes('重试'));assert.ok(view.buttons.includes('打开装配'));
	await row.children[2].children.find(button=>button.textContent==='打开装配').onclick();
	assert.deepEqual(opened,['p1']);
	let older=parts(ui.agentFailureRow({id:'q',role:'user',failure:{kind:'stopped',partial:{projectID:'p1',saved:['已新增 1 页']}}},false));
	assert.match(older.cause,/已完成：已新增 1 页/,'older rows also keep the record of saved writes');assert.deepEqual(older.buttons,[]);
});

test('a stop without saved writes and a plan-only stop keep their existing actions',async()=>{
	let {ui}=await fixture();
	let plain=parts(ui.agentFailureRow({id:'q',role:'user',failure:{kind:'stopped',message:'已停止，本次回答未保存'}},true));
	assert.equal(plain.head,'已停止 · 本次回答未生成');assert.equal(plain.cause,'已停止，本次回答未保存');assert.deepEqual(plain.buttons,['重试']);
	let plan=parts(ui.agentFailureRow({id:'q',role:'user',failure:{kind:'stopped',partial:{projectID:'p1',planVersionID:'v2',saved:['研究方案版本已保存']}}},true));
	assert.match(plan.cause,/已完成：研究方案版本已保存/);assert.ok(plan.buttons.includes('查看已保存方案'));assert.equal(plan.buttons.includes('打开装配'),false);
	let failed=parts(ui.agentFailureRow({id:'q',role:'user',failure:{kind:'timeout',message:'模型超时。已完成：已新增 1 页',partial:{projectID:'p1',saved:['已新增 1 页']}}},true));
	assert.equal(failed.head,'回答未完成');assert.equal(failed.cause,'模型超时。已完成：已新增 1 页');assert.ok(failed.buttons.includes('打开装配'));
});
