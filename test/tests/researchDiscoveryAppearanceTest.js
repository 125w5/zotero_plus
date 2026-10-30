/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Embedded literature search follows one appearance',function(){
 this.timeout(120000);const E=Zotero.Research,pref='extensions.easysch.writingAppearance';
 const report={type:'真实原生文献搜集页面与外观切换；推荐与模型输入受控，不联网',modes:[]};
 let win,workspace,ui,frame,folder,prior,priorPref,priorToolbar;
 const wait=async(fn,label)=>{for(let n=0;n<1000;n++){if(fn())return;await Zotero.Promise.delay(40);}throw Error('等待'+label+'超时');};
 const snapshot=async name=>{const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}};
 const rgb=text=>{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle=String(text);context.fillRect(0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data);};
 const luminance=color=>rgb(color).slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
 const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (values[0]+.05)/(values[1]+.05);};
 const nodeName=node=>node.nodeName.toLowerCase()+(node.id?'#'+node.id:'')+(node.classList?.length?'.'+[...node.classList].join('.'):'');
 // The first opaque background behind a node, across the frame boundary.
 const behind=node=>{const chain=[];let current=node;while(current){const view=current.ownerDocument.defaultView,style=view.getComputedStyle(current),color=style.backgroundColor,alpha=rgb(color)[3];chain.push({node:nodeName(current),background:color,image:style.backgroundImage});if(alpha>0||style.backgroundImage!=='none')return {color,chain};current=current.parentElement||view.frameElement;}return {color:'transparent',chain};};
 const attrs=doc=>Object.fromEntries(['data-appearance','data-easysch-appearance','data-easysch-reading-appearance','data-library-embedded','data-theme','systemdark'].map(name=>[name,doc.documentElement.getAttribute(name)]));
 async function theme(mode){Zotero.Prefs.set(pref,mode,true);Zotero.Prefs.set('browser.theme.toolbar-theme',({light:1,dark:0,auto:2})[mode],true);await wait(()=>frame.contentDocument.documentElement.dataset.appearance===(mode==='auto'?frame.contentDocument.documentElement.dataset.appearance:mode),'外观 '+mode);await Zotero.Promise.delay(300);}
 before(async()=>{
  folder=PathUtils.join(Zotero.DataDirectory.dir,'discovery-appearance-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  priorPref=Zotero.Prefs.get(pref,true);priorToolbar=Zotero.Prefs.get('browser.theme.toolbar-theme',true);
  prior={feed:E.recommendationFeed,brief:E.discoveryBrief,preview:E.discoveryPreview,models:E.workbenchModels,request:E.studio.request,selection:E.library.selection,candidates:E.library.readingCandidates};
  E.recommendationFeed=async options=>({records:[],mode:options.mode,page:options.page,hasMore:false,filterOptions:{journals:[]}});E.discoveryBrief=async row=>({text:row.abstract||'',language:'zh'});E.discoveryPreview=async()=>null;E.workbenchModels=()=>[];E.studio.request=async()=>{throw Error('外观测试不调用模型');};E.library.selection=()=>[];E.library.readingCandidates=async()=>[];
  Zotero.Prefs.set(pref,'light',true);Zotero.Prefs.set('browser.theme.toolbar-theme',1,true);
  const saved=Zotero.Session.state.windows;Zotero.Session.state.windows=[];try{win=await loadZoteroPane();await E.attachWindow(win);}finally{Zotero.Session.state.windows=saved;}
  win.resizeTo(1460,940);await E.openLibraryWorkspace(win,'discovery');workspace=win._researchLibraryWorkspace;ui=workspace.ui;frame=workspace.frame;
  await wait(()=>frame.contentDocument?.querySelector('#view-search .discovery-search-card')&&!frame.contentDocument.getElementById('view-search').hidden,'文献搜集页面');
 });
 after(async()=>{
  await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));
  workspace?.dispose();win?.close();
  if(prior){E.recommendationFeed=prior.feed;E.discoveryBrief=prior.brief;E.discoveryPreview=prior.preview;E.workbenchModels=prior.models;E.studio.request=prior.request;E.library.selection=prior.selection;E.library.readingCandidates=prior.candidates;}
  if(priorPref===undefined)Zotero.Prefs.clear(pref,true);else Zotero.Prefs.set(pref,priorPref,true);
  if(priorToolbar===undefined)Zotero.Prefs.clear('browser.theme.toolbar-theme',true);else Zotero.Prefs.set('browser.theme.toolbar-theme',priorToolbar,true);
 });
 it('keeps the page canvas, search card, tabs and heading on the same theme through light-dark-light',async()=>{
  for(const [index,mode] of ['light','dark','light'].entries()){
   await theme(mode);const doc=frame.contentDocument,view=doc.getElementById('view-search');
   const heading=view.querySelector('.discovery-page-heading h2'),card=view.querySelector('.discovery-search-card'),tabs=view.querySelector('.discovery-mode-tabs');
   const canvas=behind(heading),cardStyle=doc.defaultView.getComputedStyle(card),tabsBehind=behind(tabs),headingColor=doc.defaultView.getComputedStyle(heading).color;
   const row={mode,frame:attrs(doc),host:attrs(win.document),canvas,card:cardStyle.backgroundColor,tabs:tabsBehind.color,tabsChain:tabsBehind.chain.slice(0,2),heading:headingColor,contrast:contrast(headingColor,canvas.color),tokens:Object.fromEntries(['--ui-canvas','--ui-card','--ui-text','--bg','--es-read-tray'].map(name=>[name,doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue(name).trim()]))};
   report.modes.push(row);await snapshot('0'+(index+1)+'-search-'+mode);
   const dark=mode==='dark';
   for(const [label,color] of [['页面背景',canvas.color],['搜索卡片',row.card],['结果标签栏',row.tabs]]){if(dark)assert.isBelow(luminance(color),.2,label+'在夜间为暗色 '+color);else assert.isAbove(luminance(color),.7,label+'在日间为浅色 '+color);}
   assert.isAtLeast(row.contrast,4.5,'标题与真实背景有可读对比度');
  }
 });
 // Rendered pixels catch overlays and frame boundaries that computed
 // ancestor backgrounds cannot see.
 const sample=async points=>{const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const scale=image.width/win.innerWidth;return Object.fromEntries(Object.entries(points).map(([name,[x,y]])=>{const data=context.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data;return [name,'rgb('+data[0]+', '+data[1]+', '+data[2]+')'];}));}finally{image.close();}};
 async function rendered(target,label){
  const doc=target.contentDocument,view=doc.getElementById('view-search');
  await wait(()=>view&&!view.hidden&&view.querySelector('.discovery-search-card')?.getBoundingClientRect().height>0,label+' 文献搜集页面');await Zotero.Promise.delay(300);
  const outer=target.getBoundingClientRect(),heading=view.querySelector('.discovery-page-heading h2').getBoundingClientRect(),card=view.querySelector('.discovery-search-card').getBoundingClientRect();
  const pixels=await sample({beside:[outer.left+Math.min(heading.right+80,outer.width-20),outer.top+heading.top+heading.height/2],card:[outer.left+card.left+40,outer.top+card.top+8]});
  const headingColor=doc.defaultView.getComputedStyle(view.querySelector('.discovery-page-heading h2')).color;
  const row={label,frame:attrs(doc),host:attrs(win.document),pixels,heading:headingColor,contrast:contrast(headingColor,pixels.beside)};report.modes.push(row);await snapshot(label);
  assert.equal(luminance(pixels.beside)<.2,luminance(pixels.card)<.2,label+'：页面背景 '+pixels.beside+' 与搜索卡片 '+pixels.card+' 属于同一配色');
  assert.isAtLeast(row.contrast,4.5,label+'：标题与实际背景有可读对比度');
  return row;
 }
 it('renders one palette when dark is chosen before the library page opens',async()=>{
  workspace.dispose();Zotero.Prefs.set(pref,'dark',true);Zotero.Prefs.set('browser.theme.toolbar-theme',0,true);
  await E.openLibraryWorkspace(win,'discovery');workspace=win._researchLibraryWorkspace;frame=workspace.frame;
  await rendered(frame,'11-library-opened-dark');
 });
 it('renders one palette in a separate 文献检索 tab',async()=>{
  const tabUI=await E.openWorkflowPage('search',{win});const target=tabUI.document?.defaultView?.frameElement||[...win.document.querySelectorAll('iframe')].find(item=>item.researchPage==='search');
  try{await rendered(target,'12-search-tab-dark');Zotero.Prefs.set(pref,'light',true);Zotero.Prefs.set('browser.theme.toolbar-theme',1,true);await Zotero.Promise.delay(400);await rendered(target,'13-search-tab-light');}
  finally{const id=win.Zotero_Tabs.selectedID;if(id!=='zotero-pane')win.Zotero_Tabs.close(id);win.Zotero_Tabs.select('zotero-pane');}
 });
 it('renders one palette when the native Zotero appearance differs from the EasySch choice',async()=>{
  win.Zotero_Tabs.select('zotero-pane');
  Zotero.Prefs.set(pref,'dark',true);Zotero.Prefs.set('browser.theme.toolbar-theme',1,true);await Zotero.Promise.delay(400);await rendered(frame,'14-easysch-dark-native-light');
  Zotero.Prefs.set(pref,'light',true);Zotero.Prefs.set('browser.theme.toolbar-theme',0,true);await Zotero.Promise.delay(400);await rendered(frame,'15-easysch-light-native-dark');
  Zotero.Prefs.set(pref,'auto',true);Zotero.Prefs.set('browser.theme.toolbar-theme',2,true);await Zotero.Promise.delay(400);await rendered(frame,'16-auto');
 });
});
