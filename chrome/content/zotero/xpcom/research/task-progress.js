/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const Tools=ChromeUtils.importESModule('chrome://zotero/content/research/shared/task-progress.mjs'),registry=E.taskProgress=Tools.createTaskProgress(),hosts=new WeakMap();
 const bind=(target,name,options)=>Tools.trackAsyncMethod(target,name,registry,options);
 bind(E,'searchPaperPage',{title:'正在检索文献',optionsIndex:1});
 bind(E,'discoverySearch',{title:'正在检索论文摘要',optionsIndex:1});
 bind(E,'obtainPaper',{title:'正在下载论文 PDF',optionsIndex:1});
 bind(E,'runWorkbenchTask',{title:'AI 正在处理研究任务',optionsIndex:0});
 bind(E,'runArtifactEngine',{title:args=>({export:'正在导出 PPT',preview:'正在生成预览','manuscript-index':'正在提取论文素材','assets-index':'正在整理图片证据','assets-text':'正在读取论文文字','manuscript-export':'正在导出论文'}[args[0]?.operation]||'正在处理研究文件'),statusIndex:1,signalIndex:2,when:args=>!/(?:cache|prompt)/.test(args[0]?.operation||'')});
 bind(E.studio,'request',{title:'AI 正在分析与生成',statusIndex:2,signalIndex:3});
 bind(E.notebook,'evaluate',{title:'正在分析可行性方案',statusIndex:2,signalIndex:3});
 bind(E.notebook,'collectProjectMaterials',{title:'正在整理项目素材',statusIndex:1,signalIndex:2});
 const article={title:'正在整理论文素材',key:args=>'article:'+Number(args[0])};
 bind(E.manuscripts,'queueArticle',{...article,optionsIndex:1,callback:'status',onlyExistingCallback:true});
 bind(E.manuscripts,'indexArticle',{...article,statusIndex:1,signalIndex:2});
 E.installTaskProgress=win=>{
  if(hosts.has(win))return hosts.get(win);const doc=win.document,bar=doc.getElementById('toolbar-menubar'),menus=doc.getElementById('menubar-items'),titlebar=doc.getElementById('titlebar');if(!bar||!menus)return null;
  const node=(tag,cls)=>{const value=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(cls)value.className=cls;return value;};
  const style=node('link');style.rel='stylesheet';style.href='chrome://zotero/content/research/shared/task-progress.css';(doc.head||doc.documentElement).append(style);
  const root=node('div','research-task-progress');root.id='easysch-task-progress';root.setAttribute('aria-label','科研任务进度');const label=node('span','research-task-progress-label'),track=node('div','research-task-progress-track'),fill=node('span','research-task-progress-fill'),count=node('span','research-task-progress-count');track.setAttribute('role','progressbar');track.setAttribute('aria-label','当前科研任务');track.append(fill);root.append(label,track,count);menus.after(root);bar.dataset.researchProgress='true';if(titlebar)titlebar.dataset.researchProgress='true';
  const off=registry.subscribe(value=>{root.dataset.state=value.state;root.dataset.determinate=String(value.determinate);root.setAttribute('aria-busy',String(value.pending>0));label.textContent=value.pending?value.title:value.state==='error'?'任务未完成':value.state==='cancelled'?'已停止':'就绪';count.textContent=value.pending>1?value.pending+' 项':value.determinate?Math.floor(value.done/value.total*100)+'%':'';root.title=value.pending?value.tasks.map(row=>[row.title,row.detail].filter(Boolean).join(' · ')).join('\n'):value.outcome?.message||'科研任务进度';
   if(value.determinate){track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',String(value.total));track.setAttribute('aria-valuenow',String(value.done));fill.style.width=value.done/value.total*100+'%';}else{track.removeAttribute('aria-valuemin');track.removeAttribute('aria-valuemax');track.removeAttribute('aria-valuenow');fill.style.width='';}track.setAttribute('aria-valuetext',value.pending?(value.detail||value.title):label.textContent);
  });
  const host={root,begin:options=>registry.begin(options),dispose(){off();root.remove();style.remove();delete bar.dataset.researchProgress;if(titlebar)delete titlebar.dataset.researchProgress;delete win._researchTaskProgress;hosts.delete(win);}};hosts.set(win,host);win._researchTaskProgress=host;return host;
 };
 E.disposeTaskProgress=win=>hosts.get(win)?.dispose();
})(Zotero.Research);
