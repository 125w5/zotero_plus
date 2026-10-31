/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A small DOM for running the real notebook page (notebook.html, notebook.mjs and
// its installers) in Node. It covers what that page touches; it is not a general DOM.
const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
let camel=s=>s.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),kebab=s=>s.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
// Errors thrown by page handlers, so a test can assert that none happened.
export const handlerFailures=[];
function report(run){try{let result=run();if(result&&typeof result.then==='function')result.then(undefined,error=>handlerFailures.push(error));}catch(error){handlerFailures.push(error);}}
export class FakeEvent{constructor(type,init={}){Object.assign(this,init);this.type=type;this.bubbles=!!init.bubbles;this.cancelable=!!init.cancelable;this.defaultPrevented=false;this.target=null;this.currentTarget=null;this._stop=false;}preventDefault(){if(this.cancelable)this.defaultPrevented=true;}stopPropagation(){this._stop=true;}stopImmediatePropagation(){this._stop=true;}}
export class Target{
	constructor(){this._listeners=[];}
	addEventListener(type,fn,options){if(!fn)return;let capture=typeof options==='boolean'?options:!!options?.capture;if(this._listeners.some(l=>l.type===type&&l.fn===fn&&l.capture===capture))return;this._listeners.push({type,fn,capture,once:!!options?.once});}
	removeEventListener(type,fn,options){let capture=typeof options==='boolean'?options:!!options?.capture;this._listeners=this._listeners.filter(l=>!(l.type===type&&l.fn===fn&&l.capture===capture));}
	_fire(event,phase){
		event.currentTarget=this;
		for(let l of [...this._listeners]){if(event._stop)break;if(l.type!==event.type||phase==='capture'&&!l.capture||phase==='bubble'&&l.capture)continue;if(l.once)this.removeEventListener(l.type,l.fn,l.capture);report(()=>typeof l.fn==='function'?l.fn.call(this,event):l.fn.handleEvent(event));}
		let handler=phase==='capture'?null:this['on'+event.type];if(typeof handler==='function')report(()=>handler.call(this,event));
	}
	dispatchEvent(event){
		if(!(event instanceof FakeEvent))event=new FakeEvent(event.type,{bubbles:event.bubbles,cancelable:event.cancelable});
		event.target=this;let path=[];for(let node=this.parentNode;node;node=node.parentNode)path.push(node);let win=path.at(-1)?.defaultView;if(win)path.push(win);
		for(let node of [...path].reverse()){if(event._stop)break;node._fire(event,'capture');}
		if(!event._stop)this._fire(event,'target');
		if(event.bubbles)for(let node of path){if(event._stop)break;node._fire(event,'bubble');}
		return !event.defaultPrevented;
	}
}
class Node extends Target{
	constructor(doc){super();this.ownerDocument=doc;this.parentNode=null;this.childNodes=[];}
	get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
	get children(){return this.childNodes.filter(node=>node.nodeType===1);}
	get firstElementChild(){return this.children[0]||null;}
	get lastElementChild(){return this.children.at(-1)||null;}
	get firstChild(){return this.childNodes[0]||null;}
	get textContent(){return this.childNodes.map(node=>node.textContent).join('');}
	set textContent(value){for(let node of this.childNodes)node.parentNode=null;this.childNodes=[];if(value!=null&&String(value)!=='')this._insert(String(value),null);}
	_insert(node,ref){if(typeof node!=='object'||node===null)node=new Text(this.ownerDocument||this,String(node));if(node.nodeType===11){for(let child of [...node.childNodes])this._insert(child,ref);return node;}node.parentNode?.removeChild(node);node.parentNode=this;let index=ref?this.childNodes.indexOf(ref):-1;if(index<0)this.childNodes.push(node);else this.childNodes.splice(index,0,node);return node;}
	append(...nodes){for(let node of nodes)this._insert(node,null);}
	prepend(...nodes){let first=this.childNodes[0]||null;for(let node of nodes)this._insert(node,first);}
	appendChild(node){return this._insert(node,null);}
	insertBefore(node,ref){return this._insert(node,ref);}
	removeChild(node){let index=this.childNodes.indexOf(node);if(index>=0)this.childNodes.splice(index,1);node.parentNode=null;return node;}
	replaceChildren(...nodes){for(let node of this.childNodes)node.parentNode=null;this.childNodes=[];this.append(...nodes);}
	before(...nodes){let parent=this.parentNode;if(parent)for(let node of nodes)parent._insert(node,this);}
	after(...nodes){let parent=this.parentNode;if(!parent)return;let next=parent.childNodes[parent.childNodes.indexOf(this)+1]||null;for(let node of nodes)parent._insert(node,next);}
	replaceWith(...nodes){let parent=this.parentNode;if(!parent)return;let next=parent.childNodes[parent.childNodes.indexOf(this)+1]||null;parent.removeChild(this);for(let node of nodes)parent._insert(node,next);}
	remove(){this.parentNode?.removeChild(this);}
	contains(node){for(let current=node;current;current=current.parentNode)if(current===this)return true;return false;}
	get isConnected(){let root=this;while(root.parentNode)root=root.parentNode;return root.nodeType===9;}
	querySelectorAll(selector){let out=[],walk=node=>{for(let child of node.childNodes)if(child.nodeType===1){if(selectorMatches(child,selector))out.push(child);walk(child);}};walk(this);return out;}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
class Text extends Node{constructor(doc,data){super(doc);this.nodeType=3;this.data=data;}get textContent(){return this.data;}set textContent(value){this.data=String(value);}}
let reflect=(attr)=>({get(){return this.getAttribute(attr)??'';},set(value){this.setAttribute(attr,value);}});
let flag=attr=>({get(){return this.hasAttribute(attr);},set(value){this.toggleAttribute(attr,!!value);}});
export class Element extends Node{
	constructor(doc,tag){
		super(doc);this.nodeType=1;this.localName=tag.toLowerCase();this.tagName=this.localName.toUpperCase();this.attributes=new Map();this._props={};let self=this;
		this.style={setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}};
		this.dataset=new Proxy({},{get:(_,key)=>typeof key==='string'?self.getAttribute('data-'+kebab(key))??undefined:undefined,set:(_,key,value)=>{self.setAttribute('data-'+kebab(key),value);return true;},deleteProperty:(_,key)=>{self.removeAttribute('data-'+kebab(key));return true;},has:(_,key)=>self.hasAttribute('data-'+kebab(key)),ownKeys:()=>[...self.attributes.keys()].filter(key=>key.startsWith('data-')).map(key=>camel(key.slice(5))),getOwnPropertyDescriptor:(_,key)=>self.hasAttribute('data-'+kebab(key))?{enumerable:true,configurable:true,writable:true,value:self.getAttribute('data-'+kebab(key))}:undefined});
		let names=()=>(self.getAttribute('class')||'').split(/\s+/).filter(Boolean);
		this.classList={add:(...items)=>{let set=new Set(names());for(let item of items)set.add(item);self.setAttribute('class',[...set].join(' '));},remove:(...items)=>{self.setAttribute('class',names().filter(item=>!items.includes(item)).join(' '));},contains:item=>names().includes(item),toggle:(item,force)=>{let has=names().includes(item),want=force===undefined?!has:!!force;if(want&&!has)self.classList.add(item);if(!want&&has)self.classList.remove(item);return want;}};
	}
	getAttribute(key){return this.attributes.has(key)?this.attributes.get(key):null;}
	setAttribute(key,value){this.attributes.set(key,String(value));}
	removeAttribute(key){this.attributes.delete(key);}
	hasAttribute(key){return this.attributes.has(key);}
	toggleAttribute(key,force){let want=force===undefined?!this.hasAttribute(key):!!force;if(want)this.setAttribute(key,'');else this.removeAttribute(key);return want;}
	get type(){return this.getAttribute('type')??(this.localName==='button'?'submit':this.localName==='input'?'text':'');}set type(value){this.setAttribute('type',value);}
	get tabIndex(){return Number(this.getAttribute('tabindex')??-1);}set tabIndex(value){this.setAttribute('tabindex',value);}
	get draggable(){return this.getAttribute('draggable')==='true';}set draggable(value){this.setAttribute('draggable',String(!!value));}
	get checked(){return 'checked' in this._props?this._props.checked:this.hasAttribute('checked');}set checked(value){this._props.checked=!!value;}
	get indeterminate(){return !!this._props.indeterminate;}set indeterminate(value){this._props.indeterminate=!!value;}
	get selected(){return 'selected' in this._props?this._props.selected:this.hasAttribute('selected');}set selected(value){this._props.selected=!!value;}
	get options(){return this.localName==='select'?this.querySelectorAll('option'):undefined;}
	get selectedIndex(){let options=this.options||[],index=options.findIndex(option=>option.selected);if(index<0&&!this._props.valueSet)index=options.findIndex(option=>!option.disabled);return index;}
	get value(){
		if(this.localName==='select'){let option=this.options[this.selectedIndex];return option?option.value:'';}
		if(this.localName==='option')return this.hasAttribute('value')?this.getAttribute('value'):this.textContent;
		if('value' in this._props)return this._props.value;
		if(this.localName==='textarea')return this.textContent;
		if(this.localName==='input')return this.getAttribute('value')??(['checkbox','radio'].includes(this.type)?'on':'');
		return this.getAttribute('value')??'';
	}
	set value(value){
		value=value==null?'':String(value);
		if(this.localName==='select'){this._props.valueSet=true;let found=false;for(let option of this.options){let match=!found&&option.value===value;option.selected=match;if(match)found=true;}return;}
		if(this.localName==='option'){this.setAttribute('value',value);return;}
		this._props.value=value;
	}
	matches(selector){return selectorMatches(this,selector);}
	closest(selector){for(let node=this;node&&node.nodeType===1;node=node.parentNode)if(selectorMatches(node,selector))return node;return null;}
	focus(){let doc=this.ownerDocument,previous=doc._active;if(previous===this)return;doc._active=this;if(previous)previous.dispatchEvent(new FakeEvent('blur'));this.dispatchEvent(new FakeEvent('focus'));}
	blur(){let doc=this.ownerDocument;if(doc._active!==this)return;doc._active=null;this.dispatchEvent(new FakeEvent('blur'));}
	click(){if(this.disabled)return;this.dispatchEvent(new FakeEvent('click',{bubbles:true,cancelable:true}));}
	getBoundingClientRect(){return {left:0,top:0,right:0,bottom:0,width:0,height:0,x:0,y:0};}
	scrollIntoView(){}
	showModal(){this.open=true;}
	close(value){if(!this.open)return;if(value!==undefined)this.returnValue=value;this.open=false;this.dispatchEvent(new FakeEvent('close'));}
}
for(let name of ['id','title','placeholder','href','rel'])Object.defineProperty(Element.prototype,name,reflect(name));
Object.defineProperty(Element.prototype,'className',reflect('class'));Object.defineProperty(Element.prototype,'htmlFor',reflect('for'));
for(let name of ['hidden','disabled','open','inert'])Object.defineProperty(Element.prototype,name,flag(name));
export class Document extends Node{
	constructor(){super(null);this.nodeType=9;this._active=null;this.defaultView=null;}
	createElement(tag){return new Element(this,String(tag));}
	createElementNS(_namespace,tag){return new Element(this,String(tag));}
	createTextNode(text){return new Text(this,String(text));}
	createDocumentFragment(){let fragment=new Node(this);fragment.nodeType=11;return fragment;}
	get documentElement(){return this.children.find(node=>node.localName==='html')||null;}
	get head(){return this.documentElement?.children.find(node=>node.localName==='head')||null;}
	get body(){return this.documentElement?.children.find(node=>node.localName==='body')||null;}
	get activeElement(){return this._active?.isConnected?this._active:this.body;}
	getElementById(id){let walk=node=>{for(let child of node.children){if(child.id===id)return child;let found=walk(child);if(found)return found;}return null;};return walk(this);}
}
// Selectors: lists, descendant, child and sibling combinators, tag, #id, .class,
// [attr], [attr=value] and a few pseudo-classes. Unknown pseudo-classes never match.
function compound(src){let out={tag:null,id:null,classes:[],attrs:[],pseudo:[]},i=0,ident=()=>{let m=/^[\w-]+/.exec(src.slice(i));if(!m)throw Error('unsupported selector '+src);i+=m[0].length;return m[0];};
	if(src[i]==='*')i++;else if(/[a-zA-Z]/.test(src[i]||''))out.tag=ident().toLowerCase();
	while(i<src.length){let c=src[i];if(c==='#'){i++;out.id=ident();}else if(c==='.'){i++;out.classes.push(ident());}else if(c==='['){let end=src.indexOf(']',i),body=src.slice(i+1,end).trim();i=end+1;let m=/^([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?$/.exec(body);if(!m)throw Error('unsupported attribute selector '+body);out.attrs.push([m[1],m[2]||null,m[3]??m[4]??m[5]??null]);}else if(c===':'){i++;if(src[i]===':')i++;let name=ident(),arg=null;if(src[i]==='('){let end=src.indexOf(')',i);arg=src.slice(i+1,end);i=end+1;}out.pseudo.push([name,arg]);}else throw Error('unsupported selector '+src);}
	return out;}
function matchCompound(el,c){if(el.nodeType!==1||c.tag&&el.localName!==c.tag||c.id&&el.id!==c.id)return false;for(let name of c.classes)if(!el.classList.contains(name))return false;
	for(let [name,op,value]of c.attrs){let actual=el.getAttribute(name);if(actual===null)return false;if(op==='='&&actual!==value||op==='~='&&!actual.split(/\s+/).includes(value)||op==='^='&&!actual.startsWith(value)||op==='$='&&!actual.endsWith(value)||op==='*='&&!actual.includes(value))return false;}
	for(let [name,arg]of c.pseudo){if(name==='checked'){if(!el.checked)return false;}else if(name==='nth-child'){if(!el.parentNode||el.parentNode.children.indexOf(el)+1!==Number(arg))return false;}else if(name==='not'){if(selectorMatches(el,arg))return false;}else return false;}
	return true;}
function split(text,separators){let out=[],buf='',depth=0,quote=null;for(let ch of text){if(quote){buf+=ch;if(ch===quote)quote=null;continue;}if(ch==='"'||ch==="'"){quote=ch;buf+=ch;continue;}if(ch==='['||ch==='(')depth++;if(ch===']'||ch===')')depth--;if(depth===0&&separators.includes(ch)){out.push(buf,ch);buf='';continue;}buf+=ch;}out.push(buf);return out;}
function complex(text){let steps=[],comb=' ',parts=split(text.trim(),' >+~');for(let k=0;k<parts.length;k+=2){let part=parts[k].trim();if(part){steps.push({comb,c:compound(part)});comb=' ';}let sep=parts[k+1];if(sep&&sep!==' ')comb=sep;}return steps;}
function matchSteps(el,steps,index){if(!matchCompound(el,steps[index].c))return false;if(index===0)return true;let comb=steps[index].comb;
	if(comb==='>')return !!el.parentElement&&matchSteps(el.parentElement,steps,index-1);
	if(comb===' '){for(let node=el.parentElement;node;node=node.parentElement)if(matchSteps(node,steps,index-1))return true;return false;}
	let siblings=el.parentNode?.children||[],at=siblings.indexOf(el);if(comb==='+')return at>0&&matchSteps(siblings[at-1],steps,index-1);for(let k=at-1;k>=0;k--)if(matchSteps(siblings[k],steps,index-1))return true;return false;}
let parsed=new Map();
export function selectorMatches(el,selector){let list=parsed.get(selector);if(!list){list=split(selector,',').filter((_,k)=>k%2===0).filter(part=>part.trim()).map(complex);parsed.set(selector,list);}return list.some(steps=>matchSteps(el,steps,steps.length-1));}
// Parses the well-formed notebook.html: tags, attributes, text, void elements
// and comments. Script and style contents are skipped.
export function parseHTML(doc,html){let stack=[doc],i=0,text=t=>{if(t)stack.at(-1).append(new Text(doc,t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')));};
	while(i<html.length){let lt=html.indexOf('<',i);if(lt<0){text(html.slice(i));break;}if(lt>i)text(html.slice(i,lt));
		if(html.startsWith('<!--',lt)){let end=html.indexOf('-->',lt);i=end<0?html.length:end+3;continue;}
		if(html.startsWith('<!',lt)){i=html.indexOf('>',lt)+1;continue;}
		if(html[lt+1]==='/'){let end=html.indexOf('>',lt),name=html.slice(lt+2,end).trim().toLowerCase();for(let k=stack.length-1;k>0;k--)if(stack[k].localName===name){stack.length=k;break;}i=end+1;continue;}
		let m=/^[a-zA-Z][\w-]*/.exec(html.slice(lt+1));if(!m){text('<');i=lt+1;continue;}
		let name=m[0].toLowerCase(),el=new Element(doc,name),j=lt+1+m[0].length,selfClosed=false;
		for(;;){while(/\s/.test(html[j]))j++;if(html[j]==='>'){j++;break;}if(html[j]==='/'&&html[j+1]==='>'){j+=2;selfClosed=true;break;}let am=/^[^\s=>/]+/.exec(html.slice(j));if(!am){j++;continue;}let attr=am[0].toLowerCase(),value='';j+=am[0].length;while(/\s/.test(html[j]))j++;if(html[j]==='='){j++;while(/\s/.test(html[j]))j++;let q=html[j];if(q==='"'||q==="'"){let end=html.indexOf(q,j+1);value=html.slice(j+1,end);j=end+1;}else{let vm=/^[^\s>]+/.exec(html.slice(j));value=vm?vm[0]:'';j+=value.length;}}el.setAttribute(attr,value.replace(/&quot;/g,'"').replace(/&amp;/g,'&'));}
		stack.at(-1).append(el);
		if(name==='script'||name==='style'){let end=html.indexOf('</'+name,j);i=html.indexOf('>',end)+1;continue;}
		if(!VOID.has(name)&&!selfClosed)stack.push(el);i=j;}
	for(let select of doc.querySelectorAll('select')){let options=select.options;if(options.length&&!options.some(option=>option.selected))options[0].selected=true;}
}
export function createWindow(doc,extra={}){
	let win=new Target();
	Object.assign(win,{document:doc,innerWidth:1280,innerHeight:800,Event:FakeEvent,CustomEvent:FakeEvent,MouseEvent:FakeEvent,KeyboardEvent:FakeEvent,AbortController,
		setTimeout:(fn,ms,...args)=>setTimeout(fn,ms,...args),clearTimeout:handle=>clearTimeout(handle),
		requestAnimationFrame:fn=>setTimeout(()=>fn(performance.now()),16),cancelAnimationFrame:handle=>clearTimeout(handle),
		getSelection:()=>({isCollapsed:true,toString:()=>'',rangeCount:0}),getComputedStyle:()=>new Proxy({},{get:()=>''}),
		// Never calls back: prompt templates only re-scan for new inputs, and the
		// domain picker only watches for its own removal.
		MutationObserver:class{observe(){}disconnect(){}takeRecords(){return [];}}},extra);
	win.window=win;doc.defaultView=win;return win;
}
