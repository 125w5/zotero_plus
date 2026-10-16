/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Application-owned provider request lifecycle',function(){
 this.timeout(30000);
 const E=Zotero.Research;
 const {HttpServer}=ChromeUtils.importESModule('chrome://remote/content/server/httpd.sys.mjs');
 let httpd,baseURL,host,caller,folder,controller,readerGate;
 const held=new Set(),requests={ok:0,headers:0},fixtureID='provider-lifecycle-'+Date.now();
 const confirmed={text:'用户已确认的中文研究笔记：H₂O 与 x²',version:1,confirmed:true};
 const report={type:'原生真实应用级网络宿主、本地 HTTP 受控回复与程序触发窗口关闭；不等同真人点击或真实模型调用',tests:[],publicMetadata:{successful:0,cancelled:0},limitations:[]};
 const defer=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
 const wait=async fn=>{const end=Date.now()+5000;while(Date.now()<end){if(fn())return;await Zotero.Promise.delay(20);}throw Error('等待本地网络或窗口状态超时');};
 const finishHeld=text=>{for(const response of held){try{if(text!==undefined)response.write(unescape(encodeURIComponent(text)));response.finish();}catch{}held.delete(response);}};
 const write=async()=>{if(folder)await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));};
 const makeController=()=>new (Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(),{wantGlobalProperties:['AbortController']})).AbortController();
 const stopError=(error,name)=>{assert.exists(error);assert.equal(error.name,name);assert.equal(error.message,name==='AbortError'?'服务请求已取消':'服务请求超时，请重试');};
 before(async function(){
  if(!Zotero.Prefs.get('extensions.easysch.testProfile',true)){this.skip();return;}
  host=await loadZoteroPane();
  folder=PathUtils.join(Zotero.DataDirectory.dir,'provider-lifecycle-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  httpd=new HttpServer();httpd.start(-1);baseURL='http://127.0.0.1:'+httpd.identity.primaryPort;
  httpd.registerPathHandler('/ok',{handle(request,response){requests.ok++;response.setStatusLine(null,200,'OK');response.setHeader('Content-Type','application/json; charset=utf-8',false);response.write(unescape(encodeURIComponent(JSON.stringify({text:confirmed.text,ok:true}))));}});
  httpd.registerPathHandler('/headers',{handle(request,response){requests.headers++;response.processAsync();response.setStatusLine(null,200,'OK');response.setHeader('Content-Type','text/plain; charset=utf-8',false);held.add(response);}});
  await E.store.update(s=>{s.providerLifecycleFixture||={};s.providerLifecycleFixture[fixtureID]={...confirmed};});
 });
 afterEach(async function(){
  controller?.abort();controller=null;readerGate?.resolve('过期候选正文');readerGate=null;finishHeld();caller?.close();caller=null;
  await Zotero.Promise.delay(30);
  report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message,testType:this.currentTest.title.startsWith('live ')?'Zotero 进程内真实公开联网，未调用模型':'原生应用宿主与本地 HTTP 受控回复'});await write();
 });
 after(async()=>{
  finishHeld();if(httpd)await new Promise(resolve=>httpd.stop(resolve));
  if(host){await E.store.update(s=>{delete s.providerLifecycleFixture?.[fixtureID];if(s.providerLifecycleFixture&&!Object.keys(s.providerLifecycleFixture).length)delete s.providerLifecycleFixture;});await E.store.flush();}
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true))report.limitations.push('未启用 -LiveServices，真实公开联网两项未验证；未调用真实模型。');
  await write();host?.close();
 });
 it('uses its actual native transport for UTF-8 text and streaming response reads',async()=>{
  const text=await E.requestProvider(baseURL+'/ok',{},3000);assert.deepEqual(JSON.parse(text),{text:confirmed.text,ok:true});
  const streamed=await E.requestProvider(baseURL+'/ok',{},3000,async response=>{
   const reader=response.body.getReader(),decoder=new host.TextDecoder();let value='';
   try{while(true){const chunk=await reader.read();if(chunk.done)break;value+=decoder.decode(chunk.value,{stream:true});}return value+decoder.decode();}finally{reader.releaseLock();}
  });
  assert.equal(JSON.parse(streamed).text,confirmed.text);assert.equal(requests.ok,2);report.actualNativeTransport={utf8:true,readableStream:true};
 });
 it('receives delayed real HTTP headers after the originating library window closes',async()=>{
  caller=await loadZoteroPane();const before=requests.headers;
  const task=E.requestProvider(baseURL+'/headers',{},3000),outcome=task.then(value=>({value}),error=>({error}));
  await wait(()=>requests.headers>before);caller.close();await wait(()=>caller.closed);finishHeld('调用窗口关闭后仍完整保留的中文正文');
  const result=await outcome;assert.isUndefined(result.error,result.error?.message);assert.equal(result.value,'调用窗口关闭后仍完整保留的中文正文');
  report.callerClose={completed:true,applicationTransportSurvived:true};
 });
 it('cancels promptly after the originating window closes while HTTP headers are held',async()=>{
  caller=await loadZoteroPane();controller=makeController();const before=requests.headers;
  const task=E.requestProvider(baseURL+'/headers',{signal:controller.signal},5000),outcome=getPromiseError(task);
  await wait(()=>requests.headers>before);caller.close();await wait(()=>caller.closed);
  const start=Date.now();controller.abort();stopError(await outcome,'AbortError');assert.isBelow(Date.now()-start,1500,'不得等到关闭窗口的计时器或服务器回复');
  report.cancelAtHeaders={settled:true,callerClosed:true};
 });
 it('cancels a stalled custom reader after caller close without accepting late content over saved research',async()=>{
  caller=await loadZoteroPane();controller=makeController();const entered=defer();readerGate=defer();const gate=readerGate;
  const task=E.requestProvider(baseURL+'/ok',{signal:controller.signal},5000,async response=>{const body=await response.text();assert.equal(JSON.parse(body).text,confirmed.text);entered.resolve();return await gate.promise;});
  const accepted=task.then(value=>E.store.update(s=>{s.providerLifecycleFixture[fixtureID].text=value;})),outcome=getPromiseError(accepted);
  await entered.promise;caller.close();await wait(()=>caller.closed);const start=Date.now();controller.abort();stopError(await outcome,'AbortError');assert.isBelow(Date.now()-start,1500);
  gate.resolve('旧响应试图覆盖已确认研究资产');readerGate=null;await Zotero.Promise.delay(40);await E.store.flush();
  assert.deepEqual(E.store.get('providerLifecycleFixture',fixtureID),confirmed,'迟到的网络读取不得触发成功分支或覆盖用户研究笔记');
  const persisted=JSON.parse(await IOUtils.readUTF8(PathUtils.join(E.dataDir,'workspace.json')));assert.deepEqual(persisted.providerLifecycleFixture[fixtureID],confirmed);
  report.cancelAtReader={settled:true,lateSuccessNotAccepted:true,persistedResearchFixturePreserved:true};
 });
 it('reports a local stalled transport deadline as timeout rather than user cancellation',async()=>{
  const start=Date.now(),error=await getPromiseError(E.requestProvider(baseURL+'/headers',{},80));stopError(error,'TimeoutError');assert.isBelow(Date.now()-start,2500);
  report.timeout={distinctFromCancellation:true};
 });
 it('does not send a local request when an external signal is already cancelled',async()=>{
  controller=makeController();controller.abort();const before=requests.ok;
  stopError(await getPromiseError(E.requestProvider(baseURL+'/ok',{signal:controller.signal},3000)),'AbortError');await Zotero.Promise.delay(50);assert.equal(requests.ok,before);
 });
 it('live read-only Crossref request returns actual metadata through the application transport',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){this.skip();return;}
  const doi='10.1038/nature12373';const result=JSON.parse(await E.requestProvider('https://api.crossref.org/works/'+encodeURIComponent(doi),{headers:{Accept:'application/json'}},12000));
  assert.equal(result.message.DOI.toLowerCase(),doi);assert.isAbove(result.message.title?.[0]?.length||0,0);report.publicMetadata.successful++;
 });
 it('live read-only Crossref request aborts immediately without becoming timeout or success',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){this.skip();return;}
  controller=makeController();const start=Date.now();
  const task=E.requestProvider('https://api.crossref.org/works/10.1038%2Fnature12373',{signal:controller.signal,headers:{Accept:'application/json'}},12000),outcome=getPromiseError(task);
  controller.abort();stopError(await outcome,'AbortError');assert.isBelow(Date.now()-start,1500);report.publicMetadata.cancelled++;
 });
});
