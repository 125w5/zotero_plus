/* Shared reading/writing appearance; native PDF Reader owns its own theme. */
(() => {
 const E=window.parent.Zotero?.Research, pref='extensions.easysch.writingAppearance';
 if(!E)return;
 const Z=window.parent.Zotero;if(!Z.Prefs.get(pref,true)){Z.Prefs.set(pref,'light',true);Z.Prefs.set('browser.theme.toolbar-theme',1,true);}const media=matchMedia('(prefers-color-scheme: dark)');
 const apply=()=>{const mode=Z.Prefs.get(pref,true)||'light';document.documentElement.dataset.appearance=mode==='auto'?(media.matches?'dark':'light'):mode;window.parent.document.documentElement.dataset.easyschAppearance=document.documentElement.dataset.appearance;const select=document.getElementById('writing-appearance');if(select)select.value=mode;};
 apply();media.addEventListener('change',apply);window.addEventListener('focus',apply);
 // Every loaded workspace, including hidden frames, follows preference changes.
 // Focus alone leaves dialogs and reused pages on their previous palette.
 const observer=Z.Prefs.registerObserver(pref,apply,true);
 window.addEventListener('unload',()=>{media.removeEventListener('change',apply);window.removeEventListener('focus',apply);Z.Prefs.unregisterObserver(observer);},{once:true});
 window.ResearchAppearance={apply,set:mode=>{if(!['light','dark','auto'].includes(mode))return;Z.Prefs.set(pref,mode,true);Z.Prefs.set('browser.theme.toolbar-theme',({light:1,dark:0,auto:2})[mode],true);apply();for(const f of window.parent.document.querySelectorAll('iframe')){try{f.contentWindow.ResearchAppearance?.apply();}catch(_){/* Reader keeps its native theme. */}}}};
 window.addEventListener('DOMContentLoaded',event=>{if(event.target!==document||document.getElementById('writing-appearance'))return;const footer=document.querySelector('footer')||document.querySelector('header');if(!footer)return;const select=document.createElement('select');select.id='writing-appearance';select.setAttribute('aria-label','阅读与写作配色');for(const [value,label]of [['light','☀ 日间'],['dark','☾ 夜间'],['auto','跟随系统']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value=Z.Prefs.get(pref,true)||'light';select.onchange=()=>window.ResearchAppearance.set(select.value);footer.append(select);});
})();
