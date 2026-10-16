/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
 installAgentPaging(list, more, load, root) {
  list._endOff?.();
  if (!more || !this.agentPaging) return;
  const end = this.el('div', undefined, 'list-end-sentinel'); end.setAttribute('aria-hidden', 'true'); list.append(end);
  list._endOff = this.agentPaging.observeListEnd(end, {root, load, onError:error=>this.status(error.message,true)});
 },
 initReadingWorkbench() {
  const show = this.show.bind(this);
  const nativeWindow = () => window.parent.Zotero.getMainWindow();
  document.querySelector('.rail [data-tab=research]')?.remove();
  if(window.frameElement?.researchLibraryMode&&!window.frameElement?.researchOverlayMode)this.openAgentWorkbench=prompt=>this.E.openResearchAgent().then(ui=>{if(prompt){ui.agentInput.value=prompt;ui.updateAgentDraft();}return ui;}).catch(error=>this.status(error.message,true));
  this.show = tab => {
   if (tab === 'research') {
    return this.E.openLibraryReading(nativeWindow());
   }
   if (['home','search'].includes(tab) && !window.frameElement?.researchLibraryMode) {
    return this.E.openLibraryWorkspace(nativeWindow(),'discovery').catch(error=>this.status(error.message,true));
   }
   return show(tab);
  };
  window.addEventListener('unload',()=>{this.agentSourceList._endOff?.();this.agentHomeList._endOff?.();},{once:true});
 }
});
