import test from 'node:test';
import assert from 'node:assert/strict';
import {observeListEnd} from '../../chrome/content/zotero/research/shared/infinite-scroll.mjs';
function viewport() {
 let callback, disconnected=0;
 const root={}, win={IntersectionObserver:class {
  constructor(fn,options){callback=fn;assert.equal(options.root,root);}
  observe(){} disconnect(){disconnected++;}
 }};
 return {root,sentinel:{isConnected:true,ownerDocument:{defaultView:win}},enter:()=>callback([{isIntersecting:true}]),disconnected:()=>disconnected};
}
test('downward paging admits one pending request and observes the actual scrolling root',async()=>{
 const view=viewport();let calls=0,release;
 const off=observeListEnd(view.sentinel,{root:view.root,load:()=>{calls++;return new Promise(resolve=>release=resolve);}});
 view.enter();view.enter();assert.equal(calls,1);
 release();await new Promise(resolve=>setImmediate(resolve));view.enter();assert.equal(calls,2);
 off();view.enter();assert.equal(calls,2);assert.equal(view.disconnected(),1);release();
});
test('replacing a list suppresses a late page error and detached sentinel requests',async()=>{
 const view=viewport();let reject,errors=0,calls=0;
 const off=observeListEnd(view.sentinel,{root:view.root,load:()=>{calls++;return new Promise((_,r)=>reject=r);},onError:()=>errors++});
 view.enter();off();reject(Error('obsolete page'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(errors,0);
 const detached=viewport();detached.sentinel.isConnected=false;
 observeListEnd(detached.sentinel,{root:detached.root,load:()=>calls++});detached.enter();assert.equal(calls,1);
});
