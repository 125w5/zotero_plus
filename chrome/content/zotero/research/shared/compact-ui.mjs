/* SPDX-License-Identifier: AGPL-3.0-or-later */
const node = (doc, tag, text, cls) => {
 const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);
 if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;
};
export {dateKey,calendarTasks,mountCalendar} from './calendar.mjs';
export function searchFilter(input,content,{label='筛选',active=()=>false}={}) {
 if(input.closest('.compact-search-field'))return;
 const doc=input.ownerDocument,wrap=node(doc,'div',undefined,'compact-search-field'),toggle=node(doc,'button',undefined,'search-filter-toggle');
 const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('width','16');svg.setAttribute('height','16');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M4 5h16l-6 7v6l-4 2v-8Z');svg.append(path);toggle.append(svg);
 input.before(wrap);wrap.append(input,toggle);toggle.type='button';toggle.ariaLabel=label;toggle.title=label;toggle.setAttribute('aria-expanded','false');
 const pop=node(doc,'div',undefined,'search-filter-popover');pop.hidden=true;pop.append(content);wrap.append(pop);
 const refresh=()=>{toggle.classList.toggle('active',active());toggle.title=label+(active()?'（已启用）':'');};
 toggle.onclick=()=>{pop.hidden=!pop.hidden;toggle.setAttribute('aria-expanded',String(!pop.hidden));};
 const close=()=>{pop.hidden=true;toggle.setAttribute('aria-expanded','false');};
 const outside=e=>{if(!wrap.contains(e.target))close();};doc.addEventListener('pointerdown',outside);
 wrap.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pop.hidden){e.stopPropagation();close();input.focus();}});content.addEventListener('change',refresh);refresh();
 doc.defaultView.addEventListener('unload',()=>doc.removeEventListener('pointerdown',outside),{once:true});return {refresh};
}
