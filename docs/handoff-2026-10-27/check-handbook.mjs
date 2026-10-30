// Offline document checks only. jsdom is a DOM model, not a rendering browser.
// No external resources are loaded and no application/library/API is accessed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const qaDependency=process.env.HANDBOOK_QA_MODULES;
const {JSDOM,VirtualConsole}=qaDependency
 ? require(path.join(qaDependency,'jsdom')) : require('jsdom');
const html=await fs.readFile(path.join(dir,'index.html'),'utf8');
const script=await fs.readFile(path.join(dir,'handbook.js'),'utf8');
const errors=[],checks=[];
const vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(String(error.message)));
const dom=new JSDOM(html,{url:'https://offline-handbook.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
const w=dom.window,d=w.document,$=id=>d.getElementById(id);
let printRequested=false,scrollTarget=null,downloadClicked=false;
w.HTMLElement.prototype.scrollIntoView=function(){scrollTarget=this.id;};
w.IntersectionObserver=class{observe(){}disconnect(){}};
w.print=()=>{printRequested=true;};
w.URL.createObjectURL=()=> 'blob:offline-test';w.URL.revokeObjectURL=()=>{};
w.HTMLAnchorElement.prototype.click=function(){downloadClicked=!!this.download;};
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
w.eval(script);
const check=(name,action)=>{action();checks.push(name);};
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const fill=(el,value)=>{el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const pause=()=>new Promise(resolve=>setTimeout(resolve,140));
const meta=JSON.parse($('handbook-metadata').textContent);
check('all chapters render with unique IDs',()=>{
 assert.equal(d.querySelectorAll('.chapter').length,meta.sections.length);
 const ids=[...d.querySelectorAll('[id]')].map(n=>n.id);assert.equal(new Set(ids).size,ids.length);
});
check('all internal links resolve',()=>{for(const a of d.querySelectorAll('a[href^="#"]'))assert.ok($(decodeURIComponent(a.hash.slice(1))),a.href);});
check('no network assets or executable external code',()=>{
 assert.equal(d.querySelectorAll('script[src],link[href],iframe[src],object,embed').length,0);
 for(const img of d.querySelectorAll('.real-shot img'))assert.ok(img.src.startsWith('data:image/png;base64,'));
 assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(script));
 assert.ok(!/url\(\s*["']?https?:/i.test(d.querySelector('style').textContent));
 assert.ok(!/\bsk-[A-Za-z0-9_-]{16,}/.test(html));
});
check('three reading routes produce working chapter links',()=>{
 for(const b of d.querySelectorAll('[data-route]')){click(b);assert.equal(b.getAttribute('aria-pressed'),'true');assert.ok($('route-output').querySelectorAll('a').length>=3);}
});
check('four layout maps switch responsibilities',()=>{
 for(const b of d.querySelectorAll('[data-map]')){click(b);assert.equal(b.getAttribute('aria-pressed'),'true');assert.ok($('map-main-title').textContent.length>2);}
 assert.equal($('map-object-title').textContent,'当前资料与已生成PPT');
});
fill($('search'),'缓存');await pause();
check('Chinese full-text search filters chapters and shows results',()=>{
 assert.equal($('search-results').hidden,false);assert.ok($('search-results').querySelectorAll('a').length>=5);
 assert.ok(d.querySelectorAll('.chapter[hidden]').length>0);assert.equal(scrollTarget,'search-results');
});
click($('search-results').querySelector('a'));
check('search result navigation restores full manual',()=>{assert.equal($('search').value,'');assert.equal(d.querySelectorAll('.chapter[hidden]').length,0);assert.equal($('search-results').hidden,true);});
fill($('search'),'__NO_MATCH_2026__');await pause();
check('empty search result is explicit',()=>{assert.equal($('search-results').querySelectorAll('a').length,0);assert.match($('search-results').textContent,/未找到相关章节/);});
fill($('search'),'<img src=x onerror=alert(1)>');await pause();
check('search input is escaped as text',()=>{assert.equal($('search-results').querySelectorAll('img,script').length,0);});
$('search').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
check('Escape clears search',()=>{assert.equal($('search').value,'');assert.equal(d.querySelectorAll('.chapter[hidden]').length,0);});
d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));
check('Ctrl+K focuses manual search',()=>assert.equal(d.activeElement,$('search')));
click($('toc-toggle'));
check('compact directory opens and updates aria state',()=>{assert.ok($('sidebar').classList.contains('open'));assert.equal($('toc-toggle').getAttribute('aria-expanded'),'true');});
click(d.querySelector('.sidebar nav a'));
check('directory navigation closes compact directory',()=>assert.ok(!$('sidebar').classList.contains('open')));
fill($('demo-keyword'),'量子材料');
check('filled input has explicit visual state',()=>assert.ok($('demo-keyword').classList.contains('filled')));
click($('demo-save'));
check('action demo reports a result without a model call',()=>assert.match($('demo-feedback').textContent,/保存/));
click($('demo-menu-trigger'));
check('menu opens outside normal layout flow',()=>{assert.equal($('demo-menu').hidden,false);assert.equal($('demo-menu-trigger').getAttribute('aria-expanded'),'true');});
click(d.querySelector('[data-year="近五年"]'));
check('menu choice updates and closes',()=>{assert.match($('demo-menu-trigger').textContent,/近五年/);assert.equal($('demo-menu').hidden,true);});
click($('demo-menu-trigger'));click(d.body);
check('outside click closes menu',()=>assert.equal($('demo-menu').hidden,true));
click($('demo-expand'));
check('chat expands from bottom state',()=>assert.equal($('sample-chat').dataset.open,'true'));
click(d.querySelector('.stage-paper'));
check('single outside click dims chat',()=>{assert.equal($('sample-chat').dataset.open,'true');assert.equal($('sample-chat').dataset.dimmed,'true');});
d.querySelector('.stage-paper').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));
check('double outside click collapses chat',()=>assert.equal($('sample-chat').dataset.open,'false'));
click($('demo-expand'));click($('demo-pin'));
d.querySelector('.stage-paper').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));
check('pin protects chat from outside collapse',()=>assert.equal($('sample-chat').dataset.open,'true'));
click($('demo-collapse'));
check('explicit collapse still works when pinned',()=>assert.equal($('sample-chat').dataset.open,'false'));
click($('sample-reveal'));
check('bottom strip can reopen chat',()=>assert.equal($('sample-chat').dataset.open,'true'));
click(d.querySelector('[data-shot]'));
check('embedded screenshot zoom opens with content',()=>{assert.ok($('shot-dialog').hasAttribute('open'));assert.ok($('shot-image').src.startsWith('data:image/png;base64,'));});
click($('shot-close'));
check('screenshot close releases image reference',()=>{assert.ok(!$('shot-dialog').hasAttribute('open'));assert.ok(!$('shot-image').hasAttribute('src'));});
click($('source-download'));
check('source index download is local',()=>assert.ok(downloadClicked));
click($('print'));
check('print is explicitly requested by user action',()=>assert.ok(printRequested));
const closed=d.querySelectorAll('details:not([open])').length;
w.dispatchEvent(new w.Event('beforeprint'));
check('print opens source notes',()=>assert.equal(d.querySelectorAll('details:not([open])').length,0));
w.dispatchEvent(new w.Event('afterprint'));
check('print restores original source-note state',()=>assert.equal(d.querySelectorAll('details:not([open])').length,closed));
check('runtime reports no errors',()=>assert.deepEqual(errors,[]));
for(const source of meta.sources){
 const body=await fs.readFile(path.resolve(dir,'../..',source.path),'utf8');
 assert.equal(createHash('sha256').update(body).digest('hex'),source.sha256,source.path);
 for(const ref of source.sections)if(ref.line)assert.ok(ref.line>0&&ref.line<=body.split('\n').length,source.path+':'+ref.line);
}
checks.push('all source files match recorded SHA-256; source lines exist');
const report={date:'2026-10-27',mode:'offline static and DOM checks; no browser rendering',checks:checks.length,passed:checks,chapters:meta.sections.length,sourceFiles:meta.sources.length,networkRequests:0,browserVisualReview:false,limitations:['Local file navigation was blocked by the in-app browser URL policy. No alternate browser route was used.','DOM checks do not validate actual text wrapping, screen geometry, backdrop rendering, or pagination.']};
await fs.writeFile(path.join(dir,'qa-report.json'),JSON.stringify(report,null,2),'utf8');
console.log(JSON.stringify(report,null,2));
dom.window.close();
