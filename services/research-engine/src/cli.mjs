// SPDX-License-Identifier: AGPL-3.0-or-later
// One request over stdin; progress/result over stdout. No listener, browser or credentials on disk.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntime } from './runtime.mjs';
import { outlinePlan } from './plan.mjs';
const emit = event => process.stdout.write(JSON.stringify(event)+'\n');
let runtime;
try {
  let input='';
  for await(const chunk of process.stdin) {input+=chunk;if(Buffer.byteLength(input)>8_000_000) throw new Error('Request too large');}
  const request=JSON.parse(input);
  if(request.operation==='prompt') {
    runtime=await createRuntime({}); emit({type:'result',value:await runtime.prompt()});
  } else if(request.operation==='validate') {
    runtime=await createRuntime({evidence:request.evidence||[]});
    emit({type:'result',value:await runtime.call('validate_research_plan',{plan:request.plan})});
  } else if(request.operation==='export') {
    if(!path.isAbsolute(request.directory)) throw new Error('Output directory must be absolute');
    // Parent chosen by native file picker. A unique job directory is created exclusively.
    const directory=await fs.mkdtemp(path.join(request.directory,'easysch-deck-'));
    const evidence=request.record?.sources || [];
    runtime=await createRuntime({directory,evidence,datasets:request.datasets||[],onEvent:e=>emit({type:'progress',...e})});
    const plan=request.plan || outlinePlan(request.title,request.record);
    const log=[]; log.push({at:new Date().toISOString(),stage:'started'});
    await runtime.call('validate_research_plan',{plan});
    await fs.writeFile(path.join(directory,'plan.json'),JSON.stringify(plan,null,2));
    await fs.writeFile(path.join(directory,'evidence.json'),JSON.stringify(request.record,null,2));
    await fs.writeFile(path.join(directory,'datasets.json'),JSON.stringify(request.datasets||[],null,2));
    const result=await runtime.call('export_research_deck',{plan});
    log.push({at:new Date().toISOString(),stage:'exported',visualReview:result.visualReview});
    await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({version:1,...result,log},null,2));
    emit({type:'result',value:result});
  } else throw new Error('Unknown operation');
} catch(error) {emit({type:'error',message:error.message});process.exitCode=1;}
finally {if(runtime) await runtime.dispose();}
