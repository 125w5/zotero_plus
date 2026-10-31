/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A question card's stylesheet must already apply when the card first mounts.
// installConversationInteractions used to leave it to the first card, so the
// host scrolled to the unstyled height and the card then grew about 40px,
// leaving 确认选择 in the transcript's bottom fade (ppt:choice-footer-in-fade-mask).
import test from 'node:test';
import assert from 'node:assert/strict';
import {installConversationInteractions} from '../../chrome/content/zotero/research/shared/conversation-interactions.mjs';
import {mountConversationQuestionChoices,installQuestionChoiceStyles} from '../../chrome/content/zotero/research/shared/conversation-question-choices.mjs';

class FakeElement {
	constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.className='';this.textContent='';this.hidden=false;this.disabled=false;this.value='';}

	get isConnected(){return this===this.ownerDocument.documentElement||!!this.parentElement?.isConnected;}

	setAttribute(name,value){this.attributes[name]=String(value);}

	getAttribute(name){return Object.hasOwn(this.attributes,name)?this.attributes[name]:null;}

	append(...nodes){for(let child of nodes){child.remove();child.parentElement=this;this.children.push(child);}}

	remove(){if(this.parentElement){this.parentElement.children.splice(this.parentElement.children.indexOf(this),1);this.parentElement=null;}}

	addEventListener(){}

	removeEventListener(){}

	matches(selector){
		let data=/^\[data-([a-z-]+)\]$/.exec(selector);
		if(data)return Object.hasOwn(this.dataset,data[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()));
		if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));
		return this.tagName===selector;
	}

	querySelectorAll(selector){let found=[],walk=node=>{for(let child of node.children){if(child.matches(selector))found.push(child);walk(child);}};walk(this);return found;}

	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}

function documentFixture(){
	let doc={defaultView:{addEventListener(){},removeEventListener(){}}};
	doc.createElementNS=(_ns,tag)=>new FakeElement(doc,tag);
	doc.documentElement=new FakeElement(doc,'html');doc.head=new FakeElement(doc,'head');doc.body=new FakeElement(doc,'body');doc.documentElement.append(doc.head,doc.body);
	doc.querySelector=selector=>doc.documentElement.querySelector(selector);
	let host=()=>{let value=new FakeElement(doc,'div');doc.body.append(value);return value;};
	let sheets=marker=>doc.head.children.filter(node=>node.tagName==='link'&&node.dataset[marker]==='true');
	return {doc,host,sheets};
}

test('installing an interaction host loads the question card sheet before any card exists, once per document',async()=>{
	let {doc,host,sheets}=documentFixture(),transcript=host(),interactions=installConversationInteractions({doc,host:transcript});
	assert.equal(sheets('easyschInteractionStyle').length,1);
	let [sheet]=sheets('easyschQuestionStyle');
	assert.ok(sheet,'the question card sheet is requested at install time');
	assert.equal(sheet.rel,'stylesheet');
	assert.match(sheet.href,/\/research\/shared\/conversation-question-choices\.css$/);
	assert.equal(transcript.querySelector('.conversation-interaction-card'),null,'no card has mounted yet');
	let second=installConversationInteractions({doc,host:host()});
	assert.equal(sheets('easyschQuestionStyle').length,1,'a second host in the same document reuses the sheet');
	interactions.setSession('s1');
	let answer=interactions.requestResearchQuestion({question:'下一步做什么？',options:['补充对照','整理结论']});
	assert.ok(transcript.querySelector('.conversation-interaction-card'),'the card mounts');
	assert.ok(transcript.querySelector('.conversation-question-footer'),'with its button row');
	assert.ok(transcript.querySelector('.conversation-question-submit'));
	assert.equal(sheets('easyschQuestionStyle').length,1,'mounting the card adds no second sheet');
	transcript.querySelector('.conversation-question-cancel').onclick();
	assert.deepEqual(await answer,{action:'cancel'});
	assert.equal(transcript.querySelector('.conversation-interaction-card'),null);
	interactions.destroy();second.destroy();
});

test('choice cards mounted without an interaction host still load their sheet, and only once',()=>{
	let {doc,host,sheets}=documentFixture(),handlers={onAnswer(){},onRegenerate(){},onCancel(){}};
	mountConversationQuestionChoices({doc,host:host(),options:['甲','乙'],...handlers});
	assert.equal(sheets('easyschQuestionStyle').length,1);
	mountConversationQuestionChoices({doc,host:host(),options:['丙'],...handlers});
	installQuestionChoiceStyles(doc);
	assert.equal(sheets('easyschQuestionStyle').length,1);
});
