// SPDX-License-Identifier: AGPL-3.0-or-later
// One request over stdin; progress/result over stdout. No listener, browser or credentials on disk.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntime } from './runtime.mjs';
import { outlinePlan } from './plan.mjs';
import { renderAndInspect } from './render.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importTemplate } from './studio-template.mjs';
import { layoutDiagram, diagramSVG, diagramDrawio } from './studio-diagram.mjs';
const emit = event => process.stdout.write(JSON.stringify(event)+'\n');
let runtime, cancellationWatcher;
const abort=new AbortController();
try {
  let input='';
  for await(const chunk of process.stdin) {input+=chunk;if(Buffer.byteLength(input)>8_000_000) throw new Error('Request too large');}
  const request=JSON.parse(input);
  if(request.cancelFile) cancellationWatcher=setInterval(()=>fs.access(request.cancelFile).then(()=>abort.abort()).catch(()=>{}),150);
  if(request.operation?.startsWith('manuscript-')) {
    if(!path.isAbsolute(request.python || '')) throw new Error('请先配置论文解析 Python 工具');
    const child=spawn(request.python,['-X','utf8',fileURLToPath(new URL('../manuscript/document.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],signal:abort.signal});
    child.stdout.pipe(process.stdout); let diagnostic='';child.stderr.on('data',c=>diagnostic+=c);child.stdin.end(JSON.stringify(request));
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    if(code) throw new Error(diagnostic.trim() || '论文文档处理失败，请检查导出诊断');
  } else if(request.operation?.startsWith('assets-')) {
    if(!path.isAbsolute(request.python || '') || !path.isAbsolute(request.cacheRoot || '')) throw new Error('PDF 素材解析工具未配置');
    const child=spawn(request.python,['-X','utf8',fileURLToPath(new URL('../pdf/assets.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],signal:abort.signal});
    child.stdout.pipe(process.stdout); child.stderr.resume(); child.stdin.end(JSON.stringify(request));
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    if(code) process.exitCode=code;
  } else if(request.operation==='template-import') {
    emit({type:'result',value:await importTemplate(request.file)});
  } else if(request.operation==='diagram-layout') {
    const g=await layoutDiagram(request.diagram,{reset:request.reset});emit({type:'result',value:{geometry:g,svg:diagramSVG(request.diagram,g),drawio:diagramDrawio(request.diagram,g)}});
  } else if(request.operation==='prompt') {
    runtime=await createRuntime({}); emit({type:'result',value:await runtime.prompt()});
  } else if(request.operation==='validate') {
    runtime=await createRuntime({evidence:request.evidence||[]});
    emit({type:'result',value:await runtime.call('validate_research_plan',{plan:request.plan})});
  } else if(request.operation==='export') {
    if(!path.isAbsolute(request.directory)) throw new Error('Output directory must be absolute');
    // Parent chosen by native file picker. A unique job directory is created exclusively.
    const directory=await fs.mkdtemp(path.join(request.directory,'easysch-deck-'));
    const evidence=request.record?.sources || [];
    runtime=await createRuntime({directory,evidence,datasets:request.datasets||[],assets:request.assets||[],onEvent:e=>emit({type:'progress',...e})});
    const plan=request.plan || outlinePlan(request.title,request.record);
    const log=[]; log.push({at:new Date().toISOString(),stage:'started'});
    await runtime.call('validate_research_plan',{plan});
    await fs.writeFile(path.join(directory,'plan.json'),JSON.stringify(plan,null,2));
    await fs.writeFile(path.join(directory,'evidence.json'),JSON.stringify(request.record,null,2));
    await fs.writeFile(path.join(directory,'datasets.json'),JSON.stringify(request.datasets||[],null,2));
    let result=await runtime.call('export_research_deck',{plan});
    if(request.render) {
      emit({type:'progress',stage:'LibreOffice 逐页渲染',status:'running'});
      try { result=await renderAndInspect(result,{...request.render,signal:abort.signal}); }
      catch(error) {result={...result,renderStatus:'failed',warnings:[...result.warnings,error.message]};}
    }
    log.push({at:new Date().toISOString(),stage:'exported',visualReview:result.visualReview});
    await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({version:1,...result,log},null,2));
    emit({type:'result',value:result});
  } else throw new Error('Unknown operation');
} catch(error) {emit({type:'error',message:error.message});process.exitCode=1;}
finally {clearInterval(cancellationWatcher);if(runtime) await runtime.dispose();}
