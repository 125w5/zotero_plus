/* SPDX-License-Identifier: AGPL-3.0-or-later */
const documents = new WeakMap(), sources = new Map();

// Workbench content frames cannot reliably load chrome: stylesheet links.
// Fetch local application CSS through the main principal and install it in the
// destination document before exposing a shared pane.
export function prepareReaderPaneStyles(doc, {Zotero, name, url}) {
 let styles = documents.get(doc);
 if (!styles) { styles = new Map(); documents.set(doc, styles); }
 const existing = styles.get(name);
 if (existing) return existing;
 const win = doc.defaultView; let unloaded = !!win.closed;
 const onUnload = event => { if (event.target === doc || event.target === win) { unloaded = true; documents.delete(doc); } };
 win.addEventListener('unload', onUnload, {once:true});
 let source = sources.get(url);
 if (!source) {
  source = Zotero.HTTP.request('GET', url).then(response => response.responseText);
  sources.set(url, source);
  source.catch(() => { if (sources.get(url) === source) sources.delete(url); });
 }
 const task = source.then(css => {
  if (unloaded || win.closed) throw Error('来源页面已关闭');
  const selector = '[data-easysch-pane-style="' + name + '"]';
  const style = doc.querySelector(selector) || doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
  style.dataset.easyschPaneStyle = name; style.textContent = css;
  if (!style.isConnected) (doc.head || doc.documentElement).append(style);
  return style;
 });
 styles.set(name, task);
 task.catch(() => { win.removeEventListener('unload', onUnload); if (styles.get(name) === task) styles.delete(name); });
 return task;
}
