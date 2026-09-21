/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const dateKey = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
export const calendarTasks = store => [...new Map([...Object.values(store.projects||{}).flatMap(p=>p.tasks||[]),...(store.tasks||[])].map(t=>[t.id,t])).values()];
export function taskTone(tasks, day, today) {
 if (!tasks.length) return '';
 return tasks.every(t=>t.done)?'complete':day<today?'overdue':'pending';
}
export function mountCalendar(host,E,{openSchedule=()=>{}}={}) {
 const doc=host.ownerDocument,win=doc.defaultView;
 const el=(tag,text,cls)=>{const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const root=el('section',undefined,'compact-calendar calendar-inline'),head=el('div',undefined,'calendar-heading'),grid=el('div',undefined,'calendar-grid'),drawer=el('section',undefined,'calendar-drawer');
 root.setAttribute('aria-label','日历与待办');root.append(head,grid,drawer);host.append(root);drawer.hidden=true;
 let month=new Date(),chosen=dateKey(month);month.setDate(1);
 const tasks=()=>calendarTasks({projects:E.store.get('projects'),tasks:E.store.get('tasks')});
 const button=(text,fn,parent,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;parent.append(b);return b;};
 const updateTask=async(id,done)=>{await E.store.update(s=>{for(const t of [...(s.tasks||[]),...Object.values(s.projects||{}).flatMap(p=>p.tasks||[])])if(t.id===id)t.done=done;});render();};
 const showDay=(key,edit=false)=>{chosen=key;drawer.hidden=false;render();if(edit)drawer.querySelector('input[type=text]')?.focus();};
 const renderDrawer=()=>{
  drawer.replaceChildren();if(drawer.hidden)return;
  const bar=el('div',undefined,'calendar-heading');bar.append(el('strong',chosen));button('×',()=>{drawer.hidden=true;},bar).ariaLabel='收起当天日程';drawer.append(bar);
  const list=el('div',undefined,'calendar-tasks'),onDay=tasks().filter(t=>t.due?.slice(0,10)===chosen);
  for(const task of onDay){const row=el('label'),check=el('input');check.type='checkbox';check.checked=!!task.done;check.onchange=()=>updateTask(task.id,check.checked);row.append(check,el('span',task.title));row.ondblclick=()=>openSchedule(chosen);row.oncontextmenu=e=>{e.preventDefault();showActions(e,task);};list.append(row);}
  if(!onDay.length)list.append(el('small','当天暂无日程'));drawer.append(list);
  const form=el('form'),name=el('input'),time=el('input');name.type='text';name.placeholder='添加当天待办';name.required=true;name.ariaLabel='待办内容';time.type='time';time.value='18:00';time.ariaLabel='待办时间';const save=el('button','添加');save.type='submit';form.append(name,time,save);form.onsubmit=async e=>{e.preventDefault();if(!name.value.trim())return;save.disabled=true;try{await E.store.update(s=>{s.tasks||=[];s.tasks.push({id:'task-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),title:name.value.trim(),due:chosen+'T'+(time.value||'18:00'),done:false});});render();drawer.querySelector('input[type=text]')?.focus();}catch(error){save.title='保存失败：'+error.message;}finally{save.disabled=false;}};drawer.append(form);
 };
 const showActions=(event,task)=>{
  root.querySelector('.calendar-context')?.remove();const menu=el('div',undefined,'calendar-context');menu.setAttribute('role','menu');
  button(task?.done?'标为未完成':task?'标为完成':'添加待办',()=>{menu.remove();if(task)updateTask(task.id,!task.done);else showDay(chosen,true);},menu);
  button('管理当天日程',()=>{menu.remove();openSchedule(chosen);},menu);button('关闭',()=>menu.remove(),menu);root.append(menu);menu.querySelector('button').focus();
 };
 function render(){
  const all=tasks(),today=dateKey(new Date()),pending=all.filter(t=>!t.done&&t.due?.slice(0,10)===today);
  head.replaceChildren();button('‹',()=>{month.setMonth(month.getMonth()-1);render();},head).ariaLabel='上个月';const title=button(month.toLocaleDateString('zh-CN',{year:'numeric',month:'long'}),()=>{month=new Date();month.setDate(1);showDay(today);},head);title.title='回到今天 · '+pending.length+' 项待办';button('›',()=>{month.setMonth(month.getMonth()+1);render();},head).ariaLabel='下个月';
  grid.replaceChildren();for(const d of ['一','二','三','四','五','六','日'])grid.append(el('small',d));const start=new Date(month);start.setDate(1-((start.getDay()+6)%7));
  for(let i=0;i<42;i++){const day=new Date(start);day.setDate(start.getDate()+i);const key=dateKey(day),onDay=all.filter(t=>t.due?.slice(0,10)===key),tone=taskTone(onDay,key,today),b=button(String(day.getDate()),()=>showDay(key),grid);b.dataset.date=key;b.dataset.tone=tone;b.classList.toggle('outside',day.getMonth()!==month.getMonth());b.setAttribute('aria-pressed',String(key===chosen));if(key===today)b.setAttribute('aria-current','date');b.title=key+' · '+onDay.filter(t=>!t.done).length+' 项待办';b.ondblclick=()=>showDay(key,true);b.oncontextmenu=e=>{e.preventDefault();showDay(key);showActions(e);};}
  root.querySelector('.calendar-today')?.remove();const todayLine=el('small','今天 · '+pending.length+' 项待办','calendar-today');root.insertBefore(todayLine,drawer);renderDrawer();
 }
 root.onkeydown=e=>{if(e.key==='Escape'){drawer.hidden=true;root.querySelector('.calendar-context')?.remove();}};
 const off=E.store.subscribe?.(()=>{if(!drawer.contains(doc.activeElement))render();}),timer=win.setInterval(()=>{if(!drawer.contains(doc.activeElement))render();},60000);
 const dispose=()=>{off?.();win.clearInterval(timer);};win.addEventListener('unload',dispose,{once:true});render();return {render,dispose};
}
