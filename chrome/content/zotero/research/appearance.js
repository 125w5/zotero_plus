/* Shared reading/writing appearance; native PDF Reader owns its own theme. */
(() => {
 const E=window.parent.Zotero?.Research, pref='extensions.easysch.writingAppearance';
 if(!E)return;
 const Z=window.parent.Zotero;if(!Z.Prefs.get(pref,true)){Z.Prefs.set(pref,'light',true);Z.Prefs.set('browser.theme.toolbar-theme',1,true);}const media=matchMedia('(prefers-color-scheme: dark)');
 // A palette switch repaints at once (appearance.css, surface-native.css): easing only some colour
 // properties would briefly pair the new text with the previous background. Flushing styles while the
 // flag is set means no transition starts; it is removed once the new palette is in place.
 const switching=new Set();let settle=null;
 const release=()=>{for(const root of switching)delete root.dataset.appearanceSwitching;switching.clear();settle=null;};
 const quiet=root=>{root.dataset.appearanceSwitching='true';switching.add(root);};
 const apply=()=>{const mode=Z.Prefs.get(pref,true)||'light',root=document.documentElement,host=window.parent.document.documentElement,next=mode==='auto'?(media.matches?'dark':'light'):mode;
  if(root.dataset.appearance&&root.dataset.appearance!==next)quiet(root);if(host.dataset.easyschAppearance&&host.dataset.easyschAppearance!==next)quiet(host);
  root.dataset.appearance=next;host.dataset.easyschAppearance=next;const select=document.getElementById('writing-appearance');if(select)select.value=mode;
  if(!switching.size)return;try{getComputedStyle(root).getPropertyValue('color');if(host!==root)window.parent.getComputedStyle(host).getPropertyValue('color');}catch{/* Without a style engine there is nothing to flush. */}
  if(typeof setTimeout!=='function'){release();return;}if(settle!==null)clearTimeout(settle);settle=setTimeout(release,200);};
 apply();media.addEventListener('change',apply);window.addEventListener('focus',apply);
 // Every loaded workspace, including hidden frames, follows preference changes.
 // Focus alone leaves dialogs and reused pages on their previous palette.
 const observer=Z.Prefs.registerObserver(pref,apply,true);
 window.addEventListener('unload',()=>{media.removeEventListener('change',apply);window.removeEventListener('focus',apply);Z.Prefs.unregisterObserver(observer);if(settle!==null)clearTimeout(settle);release();},{once:true});
 window.ResearchAppearance={apply,set:mode=>{if(!['light','dark','auto'].includes(mode))return;Z.Prefs.set(pref,mode,true);Z.Prefs.set('browser.theme.toolbar-theme',({light:1,dark:0,auto:2})[mode],true);apply();for(const f of window.parent.document.querySelectorAll('iframe')){try{f.contentWindow.ResearchAppearance?.apply();}catch(_){/* Reader keeps its native theme. */}}}};
 window.addEventListener('DOMContentLoaded',event=>{if(event.target!==document||document.getElementById('writing-appearance'))return;const footer=document.querySelector('[data-appearance-host]')||document.querySelector('footer:not([hidden])')||document.querySelector('header');if(!footer)return;const select=document.createElement('select');select.id='writing-appearance';select.setAttribute('aria-label','阅读与写作配色');for(const [value,label]of [['light','☀ 日间'],['dark','☾ 夜间'],['auto','跟随系统']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value=Z.Prefs.get(pref,true)||'light';select.onchange=()=>window.ResearchAppearance.set(select.value);footer.append(select);});
})();
