/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('In-place manuscript formula editing and source recognition',function(){
	this.timeout(120000);const E=Zotero.Research,Formula=ChromeUtils.importESModule('chrome://zotero/content/research/manuscript/formula-editor.mjs');
	let win,frame,ui,projectID,host,control,prior;
	const wait=async(fn,label='公式编辑')=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(30);}throw Error('等待'+label+'超时');};
	const find=(root,text)=>[...root.querySelectorAll('button')].find(node=>node.textContent===text);
	before(async()=>{win=await loadZoteroPane();await E.attachWindow(win);const p=await E.manuscripts.create('公式原位编辑受控验收 '+Date.now());projectID=p.id;await E.manuscripts.open(p.id);await wait(()=>{frame=win.document.getElementById('manuscript-'+p.id);ui=frame?.contentWindow.ManuscriptUI;return ui?.ready;});host=frame.contentDocument.createElement('div');frame.contentDocument.body.append(host);prior={index:E.assets.index,recognize:E.assets.recognizeFormula,preview:E.previewImage};});
	afterEach(()=>{control?.dispose();control=null;host.replaceChildren();E.assets.index=prior.index;E.assets.recognizeFormula=prior.recognize;E.previewImage=prior.preview;});
	after(async()=>{host.remove();win.Zotero_Tabs.close('manuscript-'+projectID);await E.manuscripts.remove(projectID);});
	it('edits an empty central formula on a single click and never requires a side-panel textbox',async()=>{
		const b=ui.M.block('formula',ui.p.sections[0].id),other=ui.M.block('paragraph',ui.p.sections[0].id,{text:'保留用户正文'});ui.p.blocks=[b,other];ui.p.ui.blockID=b.id;ui.p.ui.rightOpen=false;ui.changed({editor:true});
		const view=ui.$('canvas').querySelector(`[data-id="${b.id}"] .formula-inline-rendered`);assert.isEmpty(view.textContent,'空公式不显示占位说明');assert.notExists(view.closest('.block').querySelector('.badge'),'公式不显示装饰性类型标签');view.click();const input=ui.$('canvas').querySelector(`[data-id="${b.id}"] .formula-inline-input`);assert.equal(frame.contentDocument.activeElement,input);assert.isFalse(input.hidden);assert.isFalse(ui.p.ui.rightOpen);
		input.value='E_{\\mathrm{F}}=x_i^2';input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));assert.equal(b.text,input.value);assert.equal(ui.p.blocks.length,2);assert.equal(other.text,'保留用户正文');
		input.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));assert.isTrue(input.hidden);assert.exists(view.querySelector('.katex'));
		ui.selectBlock(other.id);assert.equal(b.text,'E_{\\mathrm{F}}=x_i^2','old side-panel flush cannot revert inline edits');
	});
	it('finds a source by paper title or theorem tag and imports recognized LaTeX with original anchor and review state',async()=>{
		const attachmentID=987765432,material=ui.M.material({id:'native-formula-source',kind:'formula',sourceText:'The original theorem statement.',anchor:{attachmentID,pageIndex:2,sourceText:'The original theorem statement.'}}),asset={id:'native-original-equation',kind:'formula',attachmentID,pageIndex:2,pageHeight:800,bbox:[10,20,160,100],path:'fixture.png',paperTitle:'World Model',label:'Eq. 5',theoremName:'证据下界',tags:['VAE'],caption:'Original formula.'},before=JSON.stringify(asset);
		E.assets.index=async id=>{assert.equal(id,attachmentID);return {assets:[asset]};};E.previewImage=async()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
		const recognized=[];E.assets.recognizeFormula=async row=>{recognized.push(row);return {latex:'\\mathcal{L}=x_i^2',needsReview:true,uncertainties:['检查下标 i']};};
		const b=ui.M.block('formula',ui.p.sections[0].id);ui.p.materials=[material];ui.p.blocks=[b];ui.p.ui.blockID=b.id;ui.changed({editor:true});find(ui.$('details'),'从论文选择').click();await wait(()=>ui.$('details').querySelector('.formula-source-search'));
		const search=ui.$('details').querySelector('.formula-source-search');search.value='world model';search.dispatchEvent(new frame.contentWindow.Event('input'));assert.lengthOf(ui.$('details').querySelectorAll('.formula-source-card'),1);search.value='证据下界';search.dispatchEvent(new frame.contentWindow.Event('input'));assert.lengthOf(ui.$('details').querySelectorAll('.formula-source-card'),1);
		find(ui.$('details'),'识别并使用').click();await wait(()=>b.text==='\\mathcal{L}=x_i^2');assert.equal(b.type,'formula');assert.isTrue(b.formulaRecognition.needsReview);assert.equal(b.sourceAnchors[0].attachmentID,attachmentID);assert.lengthOf(recognized,1);assert.equal(JSON.stringify(asset),before);assert.equal(material.sourceText,'The original theorem statement.');
	});
	it('copies actual LaTeX and imports TeX text without copying rendered glyphs',async()=>{
		const copied=[],saved=[],testE={...E,window:{Zotero:{Utilities:{Internal:{copyTextToClipboard:value=>copied.push(value)}}}},assets:{...E.assets,importFormulaTex:async()=>[{latex:'\\frac{x_i}{2}'}]}};
		control=Formula.renderFormulaEditor(host,{E:testE,text:'x_i^2',onSave:value=>saved.push(value)});find(host,'复制 LaTeX').click();await wait(()=>copied.length===1);assert.equal(copied[0],'x_i^2');find(host,'导入 .tex').click();await wait(()=>saved.includes('\\frac{x_i}{2}'));assert.equal(control.getValue(),'\\frac{x_i}{2}');
	});
	it('renders source-based formula explanation with math and exposes a note-save action',async()=>{
		const saved=[],testE={...E,assets:{...E.assets,explainFormula:async value=>{assert.equal(value.latex,'x_i^2');return {text:'变量 $x_i$ 的平方项，含义以来源定义为准。',sources:[{id:'formula-source',attachmentID:123,pageIndex:2}],model:'controlled-fixture'};}}};
		control=Formula.renderFormulaEditor(host,{E:testE,text:'x_i^2',asset:{attachmentID:123,pageIndex:2},onSaveExplanation:record=>saved.push(record)});find(host,'解释公式').click();await wait(()=>host.querySelector('.formula-source-explanation .katex'));find(host,'保存笔记').click();await wait(()=>saved.length===1);assert.equal(saved[0].sources[0].pageIndex,2);assert.equal(saved[0].role,'assistant');assert.exists(saved[0].id);
	});
});
