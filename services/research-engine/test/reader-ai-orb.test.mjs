/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 orbBounds, clampOrb, positionFromNormalized, normalizeOrb, isOrbDrag, pdfNotePosition, rectInWindow,
} from '../../../chrome/content/zotero/research/shared/reader-ai-orb.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10,
 `${actual} should be close to ${expected}`);

function assertVisible(point, bounds, viewport) {
 assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 'coordinates remain finite');
 assert.ok(point.x >= bounds.left && point.x <= bounds.maxX);
 assert.ok(point.y >= bounds.top && point.y <= bounds.maxY);
 assert.ok(point.x >= 0 && point.y >= 0);
 assert.ok(point.x + bounds.size <= viewport.width, 'right edge stays in the native window');
 assert.ok(point.y + bounds.size <= viewport.height, 'bottom edge stays in the native window');
}

test('full native reader bounds allow the orb to reach both sides and the bottom', () => {
 const viewport = {width:1200, height:800};
 const bounds = orbBounds(viewport, {left:0, top:0, right:1200, bottom:800});
 assert.deepEqual(bounds, {left:8, top:48, right:1192, bottom:792, maxX:1152, maxY:752, size:40});
 const left = clampOrb({x:-1000, y:2000}, bounds);
 const right = clampOrb({x:2000, y:2000}, bounds);
 assert.deepEqual(left, {x:8, y:752});
 assert.deepEqual(right, {x:1152, y:752});
 assertVisible(left, bounds, viewport);
 assertVisible(right, bounds, viewport);
 assert.deepEqual(orbBounds(viewport), bounds, 'missing work area uses the full native window');
});

test('reader work area offsets keep the titlebar and reader toolbar clear', () => {
 const viewport = {width:1440, height:900};
 const bounds = orbBounds(viewport, {left:180, top:106, right:1320, bottom:788});
 assert.deepEqual(bounds, {left:188, top:154, right:1312, bottom:780, maxX:1272, maxY:740, size:40});
 assert.deepEqual(clampOrb({x:0, y:0}, bounds), {x:188, y:154});
 assertVisible(clampOrb({x:1440, y:900}, bounds), bounds, viewport);
});

test('native window shrinking clamps an old position and stale work area to visible edges', () => {
 const large = {width:1440, height:900};
 const oldArea = {left:0, top:106, right:1440, bottom:900};
 const oldBounds = orbBounds(large, oldArea);
 const previous = clampOrb({x:3000, y:3000}, oldBounds);
 const small = {width:640, height:420};
 const newBounds = orbBounds(small, oldArea);
 const moved = clampOrb(previous, newBounds);
 assert.ok(moved.x < previous.x && moved.y < previous.y, 'both edges respond to native resize');
 assertVisible(moved, newBounds, small);
 assert.deepEqual(moved, {x:newBounds.maxX, y:newBounds.maxY});
});

test('persisted normalized positions outside the window stop at the nearest edge', () => {
 const viewport = {width:1000, height:700};
 const bounds = orbBounds(viewport);
 assert.deepEqual(positionFromNormalized({x:-10, y:20}, bounds), {x:bounds.left, y:bounds.maxY});
 assert.deepEqual(positionFromNormalized({x:20, y:-10}, bounds), {x:bounds.maxX, y:bounds.top});
 assertVisible(positionFromNormalized({x:-10, y:20}, bounds), bounds, viewport);
});

test('missing or corrupted persisted coordinates use the default independently', () => {
 const bounds = orbBounds({width:1000, height:700});
 const expected = {
  x:bounds.left + .98 * (bounds.maxX - bounds.left),
  y:bounds.top + .72 * (bounds.maxY - bounds.top),
 };
 for (const saved of [undefined, null, {}, {x:NaN, y:NaN}, {x:Infinity, y:-Infinity}, {x:'broken', y:'broken'}]) {
  assert.deepEqual(positionFromNormalized(saved, bounds), expected);
 }
 const partial = positionFromNormalized({x:.25, y:NaN}, bounds);
 close(partial.x, bounds.left + .25 * (bounds.maxX - bounds.left));
 close(partial.y, expected.y);
});

test('corrupted absolute positions can be clamped and normalized safely', () => {
 const viewport = {width:1000, height:700};
 const bounds = orbBounds(viewport);
 for (const position of [undefined, null, {x:NaN, y:Infinity}, {x:'broken', y:-Infinity}]) {
  assertVisible(clampOrb(position, bounds), bounds, viewport);
  const saved = normalizeOrb(position, bounds);
  assert.ok(Number.isFinite(saved.x) && Number.isFinite(saved.y));
  assert.ok(saved.x >= 0 && saved.x <= 1 && saved.y >= 0 && saved.y <= 1);
 }
 assert.deepEqual(normalizeOrb({x:-100, y:3000}, bounds), {x:0, y:1});
});

test('tiny windows keep finite ordered bounds and a fully visible orb', () => {
 for (const viewport of [{width:64, height:48}, {width:17, height:13}, {width:3, height:2}]) {
  const bounds = orbBounds(viewport, {left:180, top:106, right:1320, bottom:788});
  for (const value of Object.values(bounds)) assert.ok(Number.isFinite(value));
  assert.ok(bounds.size > 0 && bounds.size <= Math.min(viewport.width, viewport.height));
  assert.ok(bounds.left <= bounds.maxX && bounds.top <= bounds.maxY);
  assert.ok(bounds.maxX + bounds.size <= bounds.right);
  assert.ok(bounds.maxY + bounds.size <= bounds.bottom);
  for (const position of [{x:-1000, y:-1000}, {x:1000, y:1000}]) {
   assertVisible(clampOrb(position, bounds), bounds, viewport);
  }
  const restored = positionFromNormalized({x:.98, y:.72}, bounds);
  assertVisible(restored, bounds, viewport);
  const saved = normalizeOrb(restored, bounds);
  assert.ok(Number.isFinite(saved.x) && Number.isFinite(saved.y), 'collapsed ranges do not divide by zero');
 }
});

test('normalization preserves relative position across native viewport and work area changes', () => {
 const before = orbBounds({width:1440, height:900}, {left:0, top:72, right:1440, bottom:900});
 const original = positionFromNormalized({x:.25, y:.8}, before);
 const saved = normalizeOrb(original, before);
 close(saved.x, .25);
 close(saved.y, .8);
 const viewport = {width:800, height:560};
 const after = orbBounds(viewport, {left:24, top:90, right:776, bottom:536});
 const restored = positionFromNormalized(saved, after);
 close(restored.x, after.left + .25 * (after.maxX - after.left));
 close(restored.y, after.top + .8 * (after.maxY - after.top));
 assertVisible(restored, after, viewport);
 const roundTrip = normalizeOrb(restored, after);
 close(roundTrip.x, saved.x);
 close(roundTrip.y, saved.y);
});

test('drag detection uses Euclidean distance and requires more than four pixels', () => {
 const start = {x:0, y:0};
 assert.equal(isOrbDrag(start, start), false);
 assert.equal(isOrbDrag(start, {x:4, y:0}), false);
 assert.equal(isOrbDrag(start, {x:0, y:-4}), false);
 assert.equal(isOrbDrag(start, {x:2.4, y:3.2}), false);
 assert.equal(isOrbDrag(start, {x:4.001, y:0}), true);
 assert.equal(isOrbDrag(start, {x:3, y:3}), true, 'diagonal travel combines both axes');
 assert.equal(isOrbDrag({x:300, y:200}, {x:297, y:197}), true);
 assert.equal(isOrbDrag(start, {x:6, y:8}, 10), false);
 assert.equal(isOrbDrag(start, {x:6, y:8.01}, 10), true);
});

test('message anchors use PDF viewport coordinates instead of browser pixels',()=>{
 const viewport={width:600,height:800,viewBox:[0,0,600,800],convertToPdfPoint:(x,y)=>[x,800-y]};
 const normal=pdfNotePosition({clientX:310,clientY:220,rect:{left:10,top:20,width:600,height:800},viewport,pageIndex:3});
 const zoomed=pdfNotePosition({clientX:610,clientY:420,rect:{left:10,top:20,width:1200,height:1600},viewport,pageIndex:3});
 assert.deepEqual(normal,{pageIndex:3,rects:[[289,589,311,611]]});assert.deepEqual(zoomed,normal);
 const rotated={width:800,height:600,viewBox:[0,0,600,800],convertToPdfPoint:(x,y)=>[y,x]};
 assert.deepEqual(pdfNotePosition({clientX:600,clientY:300,rect:{left:0,top:0,width:800,height:600},viewport:rotated,pageIndex:3}),normal,'rotation conversion belongs to the actual viewport');
});

test('PDF anchors are clamped inside the paper and refuse missing/outside page geometry',()=>{
 const viewport={width:600,height:800,viewBox:[0,0,600,800],convertToPdfPoint:(x,y)=>[x,800-y]},rect={left:10,top:20,width:600,height:800};
 assert.deepEqual(pdfNotePosition({clientX:10,clientY:20,rect,viewport,pageIndex:0}),{pageIndex:0,rects:[[0,778,22,800]]});
 for(const options of [{clientX:9,clientY:20},{clientX:10,clientY:821},{clientX:NaN,clientY:20},{clientX:10,clientY:20,pageIndex:-1},{clientX:10,clientY:20,viewport:null},{clientX:10,clientY:20,rect:{...rect,width:0}}])assert.equal(pdfNotePosition({rect,viewport,pageIndex:0,...options}),null);
});

test('sidebar overlay coordinates cross nested iframe offsets and CSS scale',()=>{
 const main={},first={frameElement:{offsetWidth:1000,offsetHeight:600,clientLeft:1,clientTop:1,getBoundingClientRect:()=>({left:50,top:80,width:1000,height:600}),ownerDocument:{defaultView:main}}},second={frameElement:{offsetWidth:400,offsetHeight:300,clientLeft:0,clientTop:0,getBoundingClientRect:()=>({left:20,top:40,width:800,height:600}),ownerDocument:{defaultView:first}}};
 const element={ownerDocument:{defaultView:second},getBoundingClientRect:()=>({left:3,top:4,width:100,height:200})};
 assert.deepEqual(rectInWindow(element,main),{left:77,top:129,width:200,height:400,right:277,bottom:529});
 assert.equal(rectInWindow(element,{}),null,'do not position an overlay in an unrelated window');
});
