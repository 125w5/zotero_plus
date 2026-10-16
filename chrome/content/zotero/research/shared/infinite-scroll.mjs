/* SPDX-License-Identifier: AGPL-3.0-or-later */
// One pending page per viewport, with cancellation when its list is replaced.
export function observeListEnd(sentinel, {root, load, onError = () => {}}) {
 const win = sentinel.ownerDocument.defaultView;
 let disposed = false, pending = false, frame;
 const request = async () => {
  if (disposed || pending || !sentinel.isConnected) return;
  pending = true;
  try { await load(); }
  catch (error) { if (!disposed) onError(error); }
  finally { pending = false; }
 };
 let observer;
 const check = () => {
  if (frame || disposed) return;
  frame = win.requestAnimationFrame(() => {
   frame = null;
   if (!sentinel.isConnected) return;
   const edge = root ? root.getBoundingClientRect().bottom : win.innerHeight;
   if (sentinel.getBoundingClientRect().top <= edge + 160) request();
  });
 };
 if (win.IntersectionObserver) {
  observer = new win.IntersectionObserver(entries => {
   if (entries.some(entry => entry.isIntersecting)) request();
  }, {root, rootMargin: '160px 0px'});
  observer.observe(sentinel);
 }
 else { (root || win).addEventListener('scroll', check, {passive:true}); check(); }
 return () => {
  disposed = true; observer?.disconnect();
  if (!observer) (root || win).removeEventListener('scroll', check);
  if (frame) win.cancelAnimationFrame(frame);
 };
}
