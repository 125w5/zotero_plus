/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Research appearance synchronization and native shared surfaces',function(){
 this.timeout(90000);
 const URI='chrome://zotero/content/research/',pref='extensions.easysch.writingAppearance';
 const report={type:'真实 Gecko computedStyle、原工作区样式顺序和真实翻译错误组件；受控 DOM 展示夹具，不调用网络文献或模型，也不代表整条业务流程验收',setupStages:[],tests:[],surfaces:[],readerModes:[]};
 let win,host,frame,readerFrame,folder,priorPref,priorToolbar,priorRoot,retryCount=0;
 const wait=async(fn,label)=>{for(let n=0;n<250;n++){if(await fn())return;await Zotero.Promise.delay(40);}throw Error('等待'+label+'超时');};
 const saveReport=async()=>{if(folder)await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));};
 const stage=async(name,details={})=>{report.setupStages.push({name,at:new Date().toISOString(),...details});await saveReport();};
 // A background native window may suspend animation frames. Computed layout
 // remains synchronous; do not let a screenshot helper stall the whole suite.
 const nextPaint=async view=>{
  view.document.documentElement.getBoundingClientRect();
  let painted=false;await Promise.race([new Promise(resolve=>view.requestAnimationFrame(()=>view.requestAnimationFrame(()=>{painted=true;resolve();}))),Zotero.Promise.delay(400)]);
  if(!painted){report.paintFallbacks||=[];report.paintFallbacks.push(view.document.documentElement.dataset.appearanceFixture);view.document.documentElement.getBoundingClientRect();}
 };
 const attrNames=['data-easysch-reading-appearance','data-easysch-appearance','data-appearance','data-color-scheme','data-theme','systemdark'];
 const clearTheme=doc=>attrNames.forEach(name=>doc.documentElement.removeAttribute(name));
 // Canvas resolves Gecko's rgb(), color(srgb ...) and color-mix output using
 // the browser color engine instead of a format-specific regular expression.
 const colorCache=new Map();
 const rgb=text=>{if(colorCache.has(text))return colorCache.get(text);const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle=String(text);context.fillRect(0,0,1,1);const values=Array.from(context.getImageData(0,0,1,1).data).slice(0,3);colorCache.set(text,values);return values;};
 const tokenColor=(doc,name)=>{assert.isNotEmpty(doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue(name).trim(),name+'真实主题变量存在');const probe=doc.createElementNS('http://www.w3.org/1999/xhtml','span');probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;background-color:var('+name+')';(doc.body||doc.documentElement).append(probe);try{return doc.defaultView.getComputedStyle(probe).backgroundColor;}finally{probe.remove();}};
 const assertColor=(actual,expected,label)=>assert.deepEqual(rgb(actual),rgb(expected),label);
 const luminance=color=>rgb(color).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
 const contrast=(foreground,background)=>{const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);};
 const computed=(node)=>node.ownerDocument.defaultView.getComputedStyle(node);
 const geometry=node=>{const rect=node.getBoundingClientRect(),style=computed(node);return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,fontSize:style.fontSize,fontFamily:style.fontFamily,borderRadius:style.borderRadius};};
 const assertGeometry=(actual,baseline,label)=>{for(const key of ['x','y','width','height'])assert.closeTo(actual[key],baseline[key],1,label+' '+key+'不因换色跳动');assert.equal(actual.fontSize,baseline.fontSize,label+'字号不变');assert.equal(actual.fontFamily,baseline.fontFamily,label+'字体不变');assert.equal(actual.borderRadius,baseline.borderRadius,label+'圆角不变');};
 async function snapshot(name){
  const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');
  try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}
 }
 async function makeFrame(markup,name){
  const item=win.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');item.style.cssText='width:100%;height:100%;border:0;min-width:0;background:transparent';
  item.dataset.appearanceFixture=name;
  // Set srcdoc before attaching, as in the other native HTML fixtures. A load
  // listener on an already attached about:blank iframe can observe the wrong
  // document or miss the navigation, depending on native window scheduling.
  item.srcdoc=markup;host.append(item);
  await wait(()=>item.contentDocument?.documentElement?.dataset.appearanceFixture===name&&item.contentDocument.readyState==='complete','独立 '+name+' Document 及样式加载');
  return item;
 }
 async function theme(mode){Zotero.Prefs.set(pref,mode,true);await wait(()=>frame.contentDocument.documentElement.dataset.appearance===mode,'已加载工作区实时同步 '+mode);await Zotero.Promise.delay(220);await nextPaint(frame.contentWindow);}
 before(async()=>{
  folder=PathUtils.join(Zotero.DataDirectory.dir,'research-appearance-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});await stage('begin');
  try{
  priorPref=Zotero.Prefs.get(pref,true);priorToolbar=Zotero.Prefs.get('browser.theme.toolbar-theme',true);Zotero.Prefs.set(pref,'light',true);
  const sessionWindows=Zotero.Session.state.windows;Zotero.Session.state.windows=[];try{win=await loadZoteroPane();await Zotero.Research.attachWindow(win);}finally{Zotero.Session.state.windows=sessionWindows;}
  win.restore?.();win.resizeTo(1460,960);priorRoot=win.document.documentElement.getAttribute('data-easysch-appearance');
  await stage('native-window-ready');
  host=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');host.id='research-appearance-acceptance';host.style.cssText='position:fixed;inset:82px 18px 18px;z-index:2147480000;display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:16px';win.document.documentElement.append(host);
  // Retain the production stylesheet order, including imports and final
  // overrides, without booting search, prefetch, indexing or a live model.
  const source=(await Zotero.HTTP.request('GET',URI+'workspace.html')).responseText,template=new win.DOMParser().parseFromString(source,'text/html');
  for(const node of template.querySelectorAll('script,link[rel=localization]'))node.remove();
  // srcdoc inherits a chrome document base inconsistently in this Gecko host.
  // Absolute stylesheet links keep the exact production order and let each
  // imported CSS file resolve its own relative fonts/images normally.
  for(const link of template.querySelectorAll('link[rel=stylesheet]')){const href=link.getAttribute('href');link.setAttribute('href',Services.io.newURI(href,null,Services.io.newURI(URI)).spec);}
  template.documentElement.dataset.appearanceFixture='workspace';template.documentElement.dataset.appearance='light';template.documentElement.dataset.libraryEmbedded='true';template.body.className='library-embedded library-discovery';
  template.querySelector('.workspace>main').innerHTML='<section id="view-home" class="view workbench-home"><header class="workbench-home-heading"><h2>论文推荐</h2><p class="workbench-home-description">测试显示样例</p></header><section class="workbench-personalization"><h3>个性化设置</h3><div class="discovery-source-grid"><button type="button" class="discovery-source-card" aria-pressed="false"><span>公开文献来源</span></button><button type="button" class="discovery-source-card" aria-pressed="true"><span>已选来源</span></button></div></section><section class="discovery-feed-empty"><h3>暂未找到可获取 PDF 的论文</h3><p>当前筛选没有结果。</p><button type="button">重新搜索</button></section><div id="appearance-feedback"></div></section>';
  await stage('workspace-markup-ready',{styles:[...template.querySelectorAll('link[rel=stylesheet]')].map(link=>link.getAttribute('href'))});
  frame=await makeFrame('<!doctype html>'+template.documentElement.outerHTML,'workspace');await stage('workspace-document-loaded');
  const script=frame.contentDocument.createElement('script');let scriptError;script.addEventListener('error',()=>{scriptError='真实外观脚本加载失败 '+script.src;},{once:true});script.src=URI+'appearance.js';frame.contentDocument.head.append(script);await wait(()=>{if(scriptError)throw Error(scriptError);return frame.contentWindow.ResearchAppearance;},'真实外观脚本初始化');await stage('appearance-script-ready');
  readerFrame=await makeFrame('<!doctype html><html lang="zh-CN" data-appearance-fixture="reader"><head><meta charset="utf-8"><link rel="stylesheet" href="'+URI+'shared/surface-tokens.css"></head><body><div id="reader-feedback"></div></body></html>','reader');await stage('reader-document-loaded');
  const Feedback=ChromeUtils.importESModule(URI+'shared/translation-feedback.mjs');
  for(const [doc,id]of [[frame.contentDocument,'appearance-feedback'],[readerFrame.contentDocument,'reader-feedback']]){
   Feedback.renderTranslationFeedback(doc.getElementById(id),Error('HTTP 503 受控翻译连接错误'),{Zotero,onRetry:async()=>{retryCount++;},onOriginal:async()=>{},onError:error=>{report.styleErrors||=[];report.styleErrors.push(error.message);}});
   await wait(()=>doc.querySelector('[data-easysch-pane-style="translation-feedback"]')&&doc.querySelector('[data-easysch-pane-style="reader-surface-tokens"]'),'真实反馈样式准备');
  }
  await stage('feedback-components-ready');await Zotero.Promise.delay(250);await nextPaint(frame.contentWindow);await nextPaint(readerFrame.contentWindow);await stage('setup-complete');
  }catch(error){
   report.setupError={message:error.message,stack:error.stack,frames:[...(host?.querySelectorAll('iframe')||[])].map(item=>({name:item.dataset.appearanceFixture,readyState:item.contentDocument?.readyState,marker:item.contentDocument?.documentElement?.dataset.appearanceFixture,styles:[...(item.contentDocument?.querySelectorAll('link[rel=stylesheet]')||[])].map(link=>({href:link.href,loaded:!!link.sheet}))}))};await stage('setup-failed');throw error;
  }
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await saveReport();});
 after(async()=>{
  host?.remove();if(priorPref===undefined)Zotero.Prefs.clear(pref,true);else Zotero.Prefs.set(pref,priorPref,true);if(priorToolbar===undefined)Zotero.Prefs.clear('browser.theme.toolbar-theme',true);else Zotero.Prefs.set('browser.theme.toolbar-theme',priorToolbar,true);
  if(win&&!win.closed){if(priorRoot===null)win.document.documentElement.removeAttribute('data-easysch-appearance');else win.document.documentElement.setAttribute('data-easysch-appearance',priorRoot);win.close();}
 });
 it('synchronizes existing recommendation canvas, empty state, personalization and source cards through light-dark-light without focus',async()=>{
  const doc=frame.contentDocument,nodes={main:doc.querySelector('.workspace>main'),empty:doc.querySelector('.discovery-feed-empty'),personalization:doc.querySelector('.workbench-personalization'),source:doc.querySelector('.discovery-source-card'),selected:doc.querySelector('.discovery-source-card[aria-pressed=true]'),feedback:doc.querySelector('.translation-feedback')},baseline={};
  for(const [iteration,mode]of ['light','dark','light'].entries()){
   await theme(mode);
   const rows={};for(const [name,node]of Object.entries(nodes)){const style=computed(node);rows[name]={background:style.backgroundColor,backgroundImage:style.backgroundImage,color:style.color,geometry:geometry(node)};if(!iteration)baseline[name]=rows[name];else assertGeometry(rows[name].geometry,baseline[name].geometry,name);}
   const tokens={main:'--ui-canvas',empty:'--ui-tray',source:'--ui-card',feedback:'--es-read-tray'};
   for(const [name,token]of Object.entries(tokens)){const expected=tokenColor(doc,token);assertColor(rows[name].background,expected,name+'使用自己的共享主题变量 '+token);if(mode==='dark')assert.isBelow(luminance(rows[name].background),.2,name+'暗色表面不残留白块');}
   for(const name of ['main','empty','source','selected','feedback'])assert.isAtLeast(contrast(rows[name].color,rows[name].background),4.5,name+'正文有可读对比度');
   assert.isNotEmpty(rows.personalization.backgroundImage,'个性化卡保留有层次的表面');if(mode==='dark')assert.notInclude(rows.personalization.backgroundImage,'rgb(255, 255, 255)','暗色渐变没有遗留白色块');
   if(iteration===2)for(const name of Object.keys(nodes)){assert.equal(rows[name].background,baseline[name].background);assert.equal(rows[name].backgroundImage,baseline[name].backgroundImage);assert.equal(rows[name].color,baseline[name].color);}
   report.surfaces.push({mode,iteration,rows});await snapshot('0'+(iteration+1)+'-workspace-'+mode);
  }
 });
 it('uses native Reader color-scheme attributes and keeps explicit light above system or conflicting fallback themes',async()=>{
  const doc=readerFrame.contentDocument,root=doc.documentElement,card=doc.querySelector('.translation-feedback'),baseGeometry=geometry(card);
  const modes=[{native:'dark',theme:'light',system:true,readingDark:true,uiDark:true},{native:'light',theme:'dark',system:true,readingDark:false,uiDark:false},{native:'dark',app:'light',theme:'dark',system:true,readingDark:false,uiDark:false},{native:'light',app:'dark',reading:'light',theme:'dark',system:true,readingDark:false,uiDark:true}];
  for(const mode of modes){
   clearTheme(doc);root.dataset.colorScheme=mode.native;if(mode.app)root.dataset.easyschAppearance=mode.app;if(mode.reading)root.dataset.easyschReadingAppearance=mode.reading;root.dataset.theme=mode.theme;if(mode.system)root.setAttribute('systemdark','true');root.style.colorScheme='dark';await nextPaint(doc.defaultView);
   const style=computed(card),readingTray=tokenColor(doc,'--es-read-tray'),uiCard=tokenColor(doc,'--ui-card');assertColor(style.backgroundColor,readingTray,'阅读反馈使用自己的阅读表面变量');if(mode.readingDark)assert.isBelow(luminance(style.backgroundColor),.2,'原生暗色属性控制阅读表面');else assert.isAbove(luminance(style.backgroundColor),.8,'显式浅色优先于系统或其他回退');if(mode.uiDark)assert.isBelow(luminance(uiCard),.2,'通用表面暗色生效');else assert.isAbove(luminance(uiCard),.8,'通用表面显式浅色优先');assert.isAtLeast(contrast(style.color,style.backgroundColor),4.5);assertGeometry(geometry(card),baseGeometry,'原生阅读反馈');
   report.readerModes.push({...mode,background:style.backgroundColor,color:style.color,fontSize:style.fontSize});
  }
  clearTheme(doc);root.dataset.colorScheme='dark';await nextPaint(doc.defaultView);await snapshot('04-native-reader-dark-feedback');
 });
 it('keeps the real translated-error recovery controls usable after recoloring without changing text or geometry',async()=>{
  const doc=readerFrame.contentDocument,card=doc.querySelector('.translation-feedback'),before=geometry(card),text=card.textContent,button=card.querySelector('.translation-feedback-retry');button.click();await wait(()=>retryCount===1&&!button.disabled,'真实重试按钮回调');assert.equal(card.textContent,text);assertGeometry(geometry(card),before,'翻译错误恢复卡');assert.isFalse(card.querySelector('.translation-feedback-details').open);assert.notExists(doc.querySelector('script[src*="ui/"]'),'外观夹具不启动业务和模型');assert.isUndefined(report.styleErrors);
 });
 it('keeps a larger native progress track beside the window controls in the same light and dark palette',async()=>{
  const progress=win.document.getElementById('easysch-task-progress'),track=progress.querySelector('.research-task-progress-track'),controls=win.document.querySelector('#titlebar>.titlebar-buttonbox');
  assert.exists(progress);assert.exists(controls);const lease=Zotero.Research.taskProgress.begin({title:'检查阅读准备',key:'appearance-progress-acceptance'});
  try{lease.update({done:2,total:5,text:'缓存已准备'});for(const mode of ['light','dark']){await theme(mode);const rect=progress.getBoundingClientRect(),controlRect=controls.getBoundingClientRect();assert.isAtLeast(rect.height,32);assert.isAtLeast(track.getBoundingClientRect().height,12);assert.isAbove(rect.width,400,'使用标题栏可用宽度');assert.isAtMost(rect.right,controlRect.left+1,'进度不占窗口按钮命中区');assert.isNotEmpty(computed(progress).backgroundImage);assertColor(computed(controls).backgroundColor,tokenColor(win.document,'--ui-tray'),'窗口控制区延续相同共享主题');await snapshot('05-native-progress-'+mode);report.progress||=[];report.progress.push({mode,trackHeight:track.getBoundingClientRect().height,width:rect.width,background:computed(progress).backgroundImage});}}
  finally{lease.close();}
 });
});
