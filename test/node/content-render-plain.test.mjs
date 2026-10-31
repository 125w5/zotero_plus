/* SPDX-License-Identifier: AGPL-3.0-or-later */
// R/shared/content-renderer.js builds plain text (no Markdown, HTML, TeX,
// citation or link syntax) without marked, DOMPurify or KaTeX. Its nodes must be
// exactly those of the full path (renderMarkdown) for the same text. The vendored
// marked and KaTeX auto-render run for real in a vm against a small DOM; DOMPurify
// is replaced by a strict parser for the markup marked emits, which throws on
// anything it does not model instead of guessing.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Evidence from '../../chrome/content/zotero/research/shared/chat-evidence.mjs';

const research=new URL('../../chrome/content/zotero/research/',import.meta.url);
const [markedSource,autoRenderSource,rendererSource,wrapperSource]=await Promise.all(['vendor/marked.js','vendor/auto-render.js','shared/content-renderer.js','../xpcom/research/content-renderer.js'].map(path=>readFile(new URL(path,research),'utf8')));
const NS='http://www.w3.org/1999/xhtml',VOID=new Set(['br','hr','img','input','wbr']);
const escapeText=value=>value.replace(/&/g,'&amp;').replace(/ /g,'&nbsp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escapeAttribute=value=>value.replace(/&/g,'&amp;').replace(/ /g,'&nbsp;').replace(/"/g,'&quot;');
const kebab=key=>String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
class FakeNode{
	constructor(doc){this.ownerDocument=doc;this.parentNode=null;this.childNodes=[];}
	get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
	get nextSibling(){const siblings=this.parentNode?.childNodes;return siblings?siblings[siblings.indexOf(this)+1]||null:null;}
	get textContent(){return this.childNodes.map(node=>node.textContent).join('');}
	set textContent(value){this.replaceChildren(...(String(value??'')?[String(value)]:[]));}
	remove(){const siblings=this.parentNode?.childNodes,index=siblings?siblings.indexOf(this):-1;if(index>=0)siblings.splice(index,1);this.parentNode=null;}
	nodesFrom(nodes){return nodes.flatMap(node=>typeof node==='string'?[new FakeText(this.ownerDocument,node)]:node.nodeType===11?node.childNodes.splice(0):[node]);}
	insertAt(nodes,index){for(const node of nodes){node.remove();node.parentNode=this;}this.childNodes.splice(index,0,...nodes);}
	append(...nodes){this.insertAt(this.nodesFrom(nodes),this.childNodes.length);}
	appendChild(node){this.append(node);return node;}
	insertBefore(node,before){const list=this.nodesFrom([node]);for(const row of list)row.remove();this.insertAt(list,before?this.childNodes.indexOf(before):this.childNodes.length);return node;}
	replaceChildren(...nodes){const list=this.nodesFrom(nodes);for(const node of list)node.remove();for(const node of this.childNodes)node.parentNode=null;this.childNodes=[];this.insertAt(list,0);}
	replaceWith(...nodes){const parent=this.parentNode,list=this.nodesFrom(nodes);for(const node of list)node.remove();const index=parent.childNodes.indexOf(this);this.remove();parent.insertAt(list,index);}
	replaceChild(node,old){old.replaceWith(node);return old;}
}
class FakeText extends FakeNode{
	constructor(doc,data){super(doc);this.data=String(data);}
	get nodeType(){return 3;}
	get nodeName(){return '#text';}
	get nodeValue(){return this.data;}
	set nodeValue(value){this.data=String(value);}
	get textContent(){return this.data;}
	set textContent(value){this.data=String(value??'');}
	cloneNode(){return new FakeText(this.ownerDocument,this.data);}
	get html(){return escapeText(this.data);}
}
class FakeFragment extends FakeNode{
	get nodeType(){return 11;}
	cloneNode(deep){const copy=new FakeFragment(this.ownerDocument);if(deep)copy.append(...this.childNodes.map(node=>node.cloneNode(true)));return copy;}
}
class FakeElement extends FakeNode{
	constructor(doc,tag){
		super(doc);this.tag=String(tag).toLowerCase();this.attributes=new Map();this.styles=new Map();const element=this;
		const classes=()=>(element.getAttribute('class')||'').split(/\s+/).filter(Boolean);
		this.classList={add:(...names)=>element.setAttribute('class',[...new Set([...classes(),...names])].join(' ')),contains:name=>classes().includes(name),remove:(...names)=>element.setAttribute('class',classes().filter(name=>!names.includes(name)).join(' ')),toggle:(name,on=!classes().includes(name))=>(on?element.classList.add(name):element.classList.remove(name),on)};
		this.style=new Proxy({},{get:(_target,key)=>key==='setProperty'?(name,value)=>element.setStyle(name,value):element.styles.get(kebab(key))??'',set:(_target,key,value)=>(element.setStyle(kebab(key),value),true)});
		this.dataset=new Proxy({},{get:(_target,key)=>element.getAttribute('data-'+kebab(key))??undefined,set:(_target,key,value)=>(element.setAttribute('data-'+kebab(key),String(value)),true)});
	}
	get nodeType(){return 1;}
	get nodeName(){return this.tag;}
	get tagName(){return this.tag;}
	get className(){return this.getAttribute('class')||'';}
	set className(value){this.setAttribute('class',String(value));}
	get title(){return this.getAttribute('title')||'';}
	set title(value){this.setAttribute('title',String(value));}
	get type(){return this.getAttribute('type')||'';}
	set type(value){this.setAttribute('type',String(value));}
	set tabIndex(value){this.setAttribute('tabindex',String(value));}
	setStyle(name,value){if(value===''||value===null||value===undefined)this.styles.delete(name);else this.styles.set(name,String(value));this.setAttribute('style',[...this.styles].map(([key,row])=>key+': '+row+';').join(' '));}
	getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
	setAttribute(name,value){this.attributes.set(name,String(value));}
	removeAttribute(name){this.attributes.delete(name);}
	hasAttribute(name){return this.attributes.has(name);}
	closest(selector){const tags=selector.split(',').map(row=>row.trim());assert.ok(tags.every(row=>/^[a-z0-9]+$/.test(row)),'closest supports tag selectors only: '+selector);for(let node=this;node;node=node.parentElement)if(tags.includes(node.tag))return node;return null;}
	querySelectorAll(selector){assert.match(selector,/^[a-z0-9]+$/,'querySelectorAll supports one tag only');const out=[],walk=node=>{for(const child of node.childNodes)if(child.nodeType===1){if(child.tag===selector)out.push(child);walk(child);}};walk(this);return out;}
	cloneNode(deep){const copy=new FakeElement(this.ownerDocument,this.tag);copy.attributes=new Map(this.attributes);copy.styles=new Map(this.styles);if(deep)copy.append(...this.childNodes.map(node=>node.cloneNode(true)));return copy;}
	get innerHTML(){return this.childNodes.map(node=>node.html).join('');}
	get html(){const attributes=[...this.attributes].map(([key,value])=>' '+key+'="'+escapeAttribute(value)+'"').join('');return '<'+this.tag+attributes+'>'+(VOID.has(this.tag)?'':this.innerHTML+'</'+this.tag+'>');}
	get outerHTML(){return this.html;}
}
function fakeDocument(){
	const doc={defaultView:{console,Node:{ELEMENT_NODE:1,TEXT_NODE:3},NodeFilter:{SHOW_TEXT:4}},querySelector:()=>null};
	doc.createElementNS=(_namespace,tag)=>new FakeElement(doc,tag);doc.createElement=tag=>new FakeElement(doc,tag);
	doc.createTextNode=data=>new FakeText(doc,data);doc.createDocumentFragment=()=>new FakeFragment(doc);
	const adopt=node=>{node.ownerDocument=doc;for(const child of node.childNodes)adopt(child);return node;};
	doc.importNode=(node,deep)=>adopt(node.cloneNode(deep));
	// A snapshot of the text nodes; render only changes their values while walking.
	doc.createTreeWalker=(root,whatToShow)=>{assert.equal(whatToShow,4);const nodes=[],walk=node=>{for(const child of node.childNodes){if(child.nodeType===3)nodes.push(child);else walk(child);}};walk(root);let index=-1;return {get currentNode(){return nodes[index];},nextNode:()=>nodes[++index]||null};};
	doc.head=doc.createElementNS(NS,'head');doc.documentElement=doc.createElementNS(NS,'html');
	return doc;
}
// DOMParser + DOMPurify stand-in for marked's output: tags, entities and text,
// no comments, no raw-text elements. Text between two tags becomes one node, as
// the HTML parser makes it. It throws on characters the HTML parser rewrites.
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
const decode=value=>{
	assert.doesNotMatch(value,/[\0\r\f]/,'the HTML parser rewrites NUL, CR and FF; this stand-in does not model them');
	return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,(full,decimal,hex,name)=>{if(decimal||hex)return String.fromCodePoint(parseInt(decimal||hex,decimal?10:16));assert.ok(name in ENTITIES,'unexpected entity '+full);return ENTITIES[name];});
};
const TAG=/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
function parseHTML(doc,html){
	const root=doc.createDocumentFragment(),stack=[root];let index=0;
	const text=value=>{if(value){assert.doesNotMatch(value,/[<>]/,'unparsed markup in '+JSON.stringify(html));stack.at(-1).append(doc.createTextNode(decode(value)));}};
	while(index<html.length){
		const open=html.indexOf('<',index);if(open<0){text(html.slice(index));break;}
		text(html.slice(index,open));TAG.lastIndex=open;const match=TAG.exec(html);assert.ok(match,'unexpected markup at '+JSON.stringify(html.slice(open,open+40)));index=TAG.lastIndex;
		const [,closing,rawName,rawAttributes,selfClosing]=match,name=rawName.toLowerCase();
		if(closing){assert.equal(stack.at(-1).tag,name,'unbalanced </'+name+'> in '+JSON.stringify(html));stack.pop();continue;}
		const element=doc.createElementNS(NS,name);
		for(const attribute of rawAttributes.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))element.setAttribute(attribute[1].toLowerCase(),decode(attribute[2]??attribute[3]??attribute[4]??''));
		stack.at(-1).append(element);
		if(name==='pre'&&html[index]==='\n')index++;
		if(!VOID.has(name)&&!selfClosing)stack.push(element);
	}
	assert.equal(stack.length,1,'unclosed element in '+JSON.stringify(html));
	return root;
}
// Unwraps disallowed elements and drops disallowed attributes, as DOMPurify does
// with the config render passes; script-like elements go with their content.
const FORBID_CONTENTS=new Set(['script','style','iframe','noscript','template','svg','math','title']);
function purifier(){
	let calls=0;
	return {
		get calls(){return calls;},
		sanitize(html,config){
			calls++;assert.equal(config.RETURN_DOM_FRAGMENT,true);
			const parsed=parseHTML(fakeDocument(),String(html)),allowed=new Set(config.ALLOWED_TAGS),attributes=new Set(config.ALLOWED_ATTR);
			const clean=node=>{for(const child of [...node.childNodes]){if(child.nodeType!==1)continue;clean(child);
				if(!allowed.has(child.tag)){if(FORBID_CONTENTS.has(child.tag))child.remove();else child.replaceWith(...child.childNodes);continue;}
				for(const name of [...child.attributes.keys()])if(!attributes.has(name)||name==='href'&&!config.ALLOWED_URI_REGEXP.test(child.getAttribute(name)))child.removeAttribute(name);}};
			clean(parsed);return parsed;
		}
	};
}
// KaTeX stand-in: auto-render's delimiter search and node splitting are real.
const katex={ParseError:class ParseError extends Error{},render(tex,element,options){element.className='katex';element.dataset.display=String(!!options.displayMode);element.textContent=tex;}};
// Loads marked, auto-render and the renderer into one vm global, as
// contentRenderer (xpcom/research/content-renderer.js) does with loadSubScript.
function loadContent(doc){
	const DOMPurify=purifier(),scope={window:doc.defaultView,document:doc,console,Node:doc.defaultView.Node,NodeFilter:doc.defaultView.NodeFilter,DOMPurify,katex};
	scope.globalThis=scope;scope.self=scope;const context=vm.createContext(scope);
	for(const code of [markedSource,autoRenderSource,rendererSource])vm.runInContext(code,context);
	assert.ok(scope.EasySchContent&&scope.marked&&scope.renderMathInElement,'the renderer and its libraries load');
	return {Content:scope.EasySchContent,DOMPurify,scope};
}
const doc=fakeDocument(),{Content,DOMPurify}=loadContent(doc);
// Node by node, so a text split differently also fails, not only the markup.
const shape=node=>node.nodeType===3?['#text',node.data]:[node.tag,[...node.attributes],node.childNodes.map(shape)];
const target=()=>doc.createElementNS(NS,'div');
// The plain path through render, and the full path for the same normalized text.
const both=(value,options)=>{const fast=Content.render(target(),value,options),full=Content.renderMarkdown(target(),Content.normalize(value),options);return {fast,full};};

// Shapes of material descriptions, chat messages and notes, all without syntax.
const PLAIN=[
	'实验采用独立采集批次划分训练集与测试集，避免同一录制片段同时出现在两侧。',
	'这一段在零到二十分贝的信噪比区间内，以两分贝为步长扫描识别准确率。The recognition accuracy is reported over a sweep from 0 dB to 20 dB in 2 dB steps.',
	'Training uses the Adam optimizer with an initial learning rate of 0.001.',
	'第一行\n第二行',
	'第一段\n\n第二段\n第二段第二行',
	'\n\n前后空行\n\n\n\n中间多个空行\n',
	'段落一\n\n\n',
	'括号（全角）与 (half-width) 括号、问号？感叹号！冒号：分号；',
	'他说："准确率提高了 4%!" 然后 \'停顿\' 了一下, 再看 1/2 与 3:4 的比例; 对吗?',
	'a + b = c, x - y = z, 2 dB 到 20 dB',
	'温度 25°C → 30°C，误差 ±0.5，面积 3×4 m²，商标™ 与 €10 和 😀 表情',
	'Ünïcödé café naïve résumé · Ελληνικά · Русский · 日本語のテキスト · 한국어 문장',
	'1）全角括号编号不是列表',
	'１. 全角数字也不是列表标记',
	'A1. 字母开头的编号不是列表',
	'第 3.5 倍的提升在中间出现',
	'2024年的数据在第 2 节',
	'引用《书名》“引号”‘单引号’【方括号】〔六角括号〕「直角引号」',
	'数值－全角连字符，＋全角加号',
	'"整段 JSON 字符串\\n第二行"',
	'Windows 换行\r\n第二行\r第三行',
	'é 由组合字符构成：é',
	'三点省略号……和破折号——都可以',
	'长'.repeat(3000)
];
// Anything with a chance of Markdown, HTML, TeX, citation or link syntax.
const SYNTAX=[
	'**要点**\n\n1. 第一点\n2. 变量 \\(x_i\\) 表示第 i 个采样点。',
	'*斜体* 与 _下划线_ 与 ~~删除~~',
	'snake_case_name 与 a*b*c',
	'# 一级标题', '## 二级标题', '标题\n===', '标题\n---', '> 引用一段', '- 列表项', '* 列表项', '+ 列表项', '1. 列表项', '2) 列表项', '3.5 倍提升', '---',
	'| 列 | 列 |\n| --- | --- |\n| 1 | 2 |',
	'行内 `代码` 片段', '```\n代码块\n```', '    缩进代码块',
	'公式 $x^2$ 与 $$E=mc^2$$', '行内 \\(a+b\\) 与 \\[c\\]', '价格 $5 美元', '路径 C:\\Users\\test',
	'见 [m1] 的结论', '[链接](https://example.org)', '![图](https://example.org/a.png)',
	'<https://example.org>', 'https://example.org/path', 'www.example.org', 'mail user@example.org',
	'<b>粗体</b> 和 <script>alert(1)</script>', 'a < b 而 c > d', 'A & B &amp; C',
	'竖线 a | b', '尾部两个空格  \n下一行', ' 前导空格', '尾部空格 ', '制表\t符',
	'不间断\u00a0空格', '全角\u3000空格', '零宽\u200b空格', '👨‍👩‍👧 家庭表情', 'x^2 与 {大括号}', 'C# 语言', '',
	'\n\n'
];

test('plain text renders the nodes the full path renders, without DOMPurify',()=>{
	for(const value of PLAIN){
		assert.equal(Content.isPlain(value),true,JSON.stringify(value).slice(0,80));
		const before=DOMPurify.calls,fast=Content.render(target(),value);assert.equal(DOMPurify.calls,before,'no sanitizer pass for '+JSON.stringify(value).slice(0,80));
		const full=Content.renderMarkdown(target(),Content.normalize(value));
		assert.equal(fast.outerHTML,full.outerHTML,JSON.stringify(value).slice(0,80));assert.deepEqual(shape(fast),shape(full));
	}
	assert.equal(Content.render(target(),'第一行\n第二行').outerHTML,'<div class="easysch-content" style="white-space: normal;"><p>第一行<br>第二行</p>\n</div>');
	assert.equal(Content.render(target(),'"整段 JSON 字符串\\n第二行"').innerHTML,'<p>整段 JSON 字符串<br>第二行</p>\n','a JSON string is decoded once, as before');
});

test('options do not change the plain path: sources, a handler and the bilingual original',()=>{
	const sources=[{id:'m1',stableID:'material:m1',label:'素材一'}];let opened=0;
	for(const value of PLAIN.slice(0,6))for(const options of [{sources,onSource:()=>opened++},{bilingual:true,original:'Original text'},{bilingual:true},{original:'未开启双语时不显示'},{}]){
		const {fast,full}=both(value,options);assert.equal(fast.outerHTML,full.outerHTML);assert.deepEqual(shape(fast),shape(full));
	}
	assert.equal(opened,0);
	assert.match(Content.render(target(),'译文',{bilingual:true,original:'source'}).outerHTML,/<div class="bilingual-content"><blockquote>source<\/blockquote><div><p>译文<\/p>\n<\/div><\/div>/);
	assert.throws(()=>Content.render(target(),'纯文本',null),{name:'TypeError'},'null options still throw, as before');
});

test('text with any Markdown, HTML, TeX, citation or link syntax takes the full path',()=>{
	for(const value of SYNTAX){
		assert.equal(Content.isPlain(value),false,JSON.stringify(value));
		const before=DOMPurify.calls,{fast,full}=both(value);assert.equal(DOMPurify.calls,before+2,'both renders sanitize '+JSON.stringify(value));
		assert.equal(fast.outerHTML,full.outerHTML,JSON.stringify(value));
	}
	assert.match(Content.render(target(),SYNTAX[0]).innerHTML,/^<p><strong>要点<\/strong><\/p>\n<ol>/);
	assert.match(Content.render(target(),'公式 $x^2$').innerHTML,/<span class="katex" data-display="false">x\^2<\/span>/);
	assert.match(Content.render(target(),'见 [material:m1] 的结论',{sources:[{id:'m1',stableID:'material:m1'}]}).innerHTML,/<button data-source-i-d="material:m1" type="button" class="source-citation"/);
});
test('random text the predicate accepts renders the same nodes on both paths',()=>{
	// Line starts are letters most of the time, so many strings reach the plain path;
	// the rest of each line mixes in characters that are rejected anywhere or at a line start.
	const LETTERS=[...'实验数据方法结果abcXYZéßαЖあ한'],MIDDLE=[...'实验数据方法结果abcXYZ0123456789 ，。、；：？！（）《》“”‘’…—·%\'"!?.,;:()/+-=°±×→€😀́ﬁ#$&*<>@[]\\^_`{|}~\t 　​'],BREAKS=['\n','\n\n','\n\n\n','\r\n'];
	let seed=0x2545f491;const random=()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
	const pick=list=>list[Math.floor(random()*list.length)];
	let plain=0;
	for(let run=0;run<6000;run++){
		let value='';const lines=1+Math.floor(random()*4);
		for(let line=0;line<lines;line++){if(line)value+=pick(BREAKS);value+=random()<0.8?pick(LETTERS):pick(MIDDLE);for(let i=Math.floor(random()*12);i>0;i--)value+=random()<0.9?pick(LETTERS.concat(MIDDLE.slice(0,40))):pick(MIDDLE);}
		if(!Content.isPlain(value))continue;plain++;
		const {fast,full}=both(value);
		assert.equal(fast.outerHTML,full.outerHTML,JSON.stringify(value));assert.deepEqual(shape(fast),shape(full),JSON.stringify(value));
	}
	assert.ok(plain>=1000,'enough random strings reach the plain path: '+plain);
});

test('the material descriptions and messages of the performance fixture are plain; its assistant answers are not',()=>{
	// Sentences from test/tests/researchInteractionPerformanceTest.js.
	const cn='实验采用独立采集批次划分训练集与测试集，避免同一录制片段同时出现在两侧。在零到二十分贝的信噪比区间内，以两分贝为步长扫描识别准确率。',en='The recognition accuracy is reported over a sweep from 0 dB to 20 dB in 2 dB steps. Training uses the Adam optimizer with an initial learning rate of 0.001. ';
	for(const value of [cn,cn+en+cn,'这一段'+cn,'本章报告了相位补偿在低信噪比下的效果，'+cn,cn.slice(0,60)+'本段记录相位补偿在低信噪比下的效果。'+cn.slice(60),'这一段说明'+cn,en.trim()])assert.equal(Content.isPlain(value),true,value);
	assert.equal(Content.isPlain('**要点**\n\n1. '+cn+'\n2. '+en+'\n3. 变量 \\(x_i\\) 表示第 i 个采样点。'+cn),false);
});

// xpcom/research/content-renderer.js with this renderer behind its loadSubScript.
function loadWrapper(){
	const E={},errors=[],imports=[],renders=[],globals=new WeakMap();
	const loadSubScript=(url,scope)=>{
		let sandbox=globals.get(scope);
		if(!sandbox){sandbox={...scope,DOMPurify:purifier(),katex};sandbox.globalThis=sandbox;sandbox.self=sandbox;vm.createContext(sandbox);globals.set(scope,sandbox);}
		const file=url.split('/research/').at(-1),code={'vendor/marked.js':markedSource,'vendor/auto-render.js':autoRenderSource,'shared/content-renderer.js':rendererSource}[file];
		if(code)vm.runInContext(code,sandbox);
		if(file==='shared/content-renderer.js'){const real=sandbox.EasySchContent;scope.EasySchContent={...real,render:(...args)=>(renders.push(args[1]),real.render(...args))};scope.sandbox=sandbox;}
	};
	const Zotero={Research:E,HTTP:{request:async()=>({responseText:'',response:new ArrayBuffer(0)})},logError:error=>errors.push(error),getMainWindow:()=>({btoa:value=>value})};
	vm.runInNewContext(wrapperSource,{Zotero,ChromeUtils:{importESModule:url=>(imports.push(url),Evidence)},Services:{scriptloader:{loadSubScript}}});
	return {E,errors,imports,renders};
}

test('E.renderContent builds plain text for each target and keeps only the full renders',async()=>{
	const {E,errors,imports,renders}=loadWrapper(),page=fakeDocument(),host=()=>page.createElementNS(NS,'div'),reference=loadContent(fakeDocument()).Content;
	const first=E.renderContent(host(),'素材说明\n第二行'),second=E.renderContent(host(),'素材说明\n第二行');
	assert.equal(renders.length,2,'plain text is not kept: each call builds it');
	assert.equal(first.outerHTML,second.outerHTML);assert.equal(first.outerHTML,reference.renderMarkdown(target(),'素材说明\n第二行').outerHTML);
	const math=E.renderContent(host(),'公式 $x^2$'),again=E.renderContent(host(),'公式 $x^2$');
	assert.equal(renders.length,3,'Markdown and TeX still render once and are copied');assert.equal(again.outerHTML,math.outerHTML);assert.match(again.innerHTML,/class="katex"/);
	const cited=E.renderContent(host(),'见［m1］',{sources:[{id:'m1',stableID:'material:m1'}]});
	assert.equal(cited.querySelectorAll('button').length,1,'a citation resolved from the sources is never treated as plain text');
	assert.deepEqual(imports,['chrome://zotero/content/research/shared/chat-evidence.mjs'],'chat-evidence.mjs is imported once');
	await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(errors,[]);
});
