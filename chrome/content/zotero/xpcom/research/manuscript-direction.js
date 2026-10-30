/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
	const A=E.manuscripts,D=ChromeUtils.importESModule('chrome://zotero/content/research/shared/assembly-direction.mjs');
	// Direction v3: questions derive from client candidates with stable refs (plan
	// items, chapter tasks and gaps), and the bounded input carries no material
	// excerpts. A prose edit during the call does not discard the questions.
	A.prepareDirection=async(projectID,{signal,status=()=>{},modelID='',thinkingLevel}={})=>{
  if(signal?.aborted)throw Error('已停止方向讨论');
  if(thinkingLevel!==undefined&&!['off','minimal','low','medium','high','xhigh'].includes(thinkingLevel))throw Error('请选择有效的思考强度');
		const project=A.get(projectID);if(!project)throw Error('论文项目不存在');const notebook=E.notebook?.stateView?.(projectID),readings=()=>({readings:A.readingsView?.(projectID)||null}),request=D.directionRequest(project,notebook,readings());
		status('正在根据可行性方案和章节任务整理关键方向…');
		const config=modelID?{...E.settings(),model:modelID,selectedModel:true}:await E.resolveModel({...E.settings()},{signal,purpose:'direction'});
  if(thinkingLevel!==undefined)config.thinkingLevel=thinkingLevel;
  if(signal?.aborted)throw Error('已停止方向讨论');
		let response,questions,validationError='';
		for(let attempt=0;attempt<2&&!questions;attempt++){
			response=await E.studio.request(D.DIRECTION_PROMPT_V3,validationError?{...request.input,validationError}:request.input,status,signal,{maxTokens:3500,modelConfig:config,modelPurpose:'direction',aiAction:'evidence_organize',...(validationError?{fresh:true}:{})});
			if(signal?.aborted)throw Error('已停止方向讨论');
			try{questions=D.validateDirectionQuestions(response.value,{candidates:request.candidates,plan:request.thread.plan,sectionIDs:project.sections.map(row=>row.id)});}
			catch(error){if(attempt)throw error;validationError=error.message;status('方向问题未对应方案内容，正在重新整理…');}
		}
		const current=A.get(projectID);if(!current||D.directionRequest(current,E.notebook?.stateView?.(projectID),readings()).threadSignature!==request.threadSignature)throw Error('可行性方案或章节任务已变化，请重新整理方向问题');
		const discussion={version:D.DIRECTION_VERSION,id:'discussion-'+Zotero.Utilities.randomString(12),questions,relocations:D.validateDirectionRelocations(response.value?.relocations,current),answers:{},index:0,model:response.model,createdAt:new Date().toISOString()};
		// signature keeps the legacy value so the retained draft path still works;
		// threadSignature is what decides whether this discussion is current.
		discussion.signature=D.directionSignature(current);discussion.threadSignature=D.directionThreadSignature(current,request.thread,questions);return discussion;
	};
	// The final confirm writes one notebook decision per answered question.
	A.confirmDirection=async(projectID,discussion)=>{
		const project=A.get(projectID);if(!project)throw Error('论文项目不存在');if(!discussion?.questions?.length||D.directionDecisionRows(discussion).length!==discussion.questions.length)throw Error('请先回答全部方向问题');
		if(!D.directionCurrent({...project,directionDiscussion:discussion},discussion))throw Error('可行性方案或章节任务已变化，请更新方向问题');
		const discussionID=D.directionDiscussionID(discussion),rows=D.directionDecisionRows(discussion,{discussionID});
		if(E.notebook?.recordDirectionDecisions)await E.notebook.recordDirectionDecisions(projectID,discussionID,rows);return {discussionID,rows};
	};
	A.prepareDraft=async(projectID,{instruction='',signal,status=()=>{},modelID='',thinkingLevel='off',global=false}={})=>{
  if(signal?.aborted)throw Error('已停止；已写正文保留');if(typeof instruction!=='string'||instruction.length>12000)throw Error('修改要求需要为 12000 字以内的文字');
		const project=A.get(projectID);if(!project)throw Error('论文项目不存在');const discussion=project.directionDiscussion;
  if(!global){if(!discussion||discussion.signature!==D.directionSignature(project))throw Error('请先完成当前装配版本的方向讨论');const questions=D.validateDirectionQuestions(discussion);if(questions.some((row,index)=>row.id!==discussion.questions[index].id)||D.directionDecisions(discussion).length!==discussion.questions.length)throw Error('请先完成当前装配版本的方向讨论');}
		const decisions=D.directionDecisions(discussion);
  // Plans and earlier choices are context data, not the user's current action.
  // In particular a planned figure must not activate the image-intent guard.
		const batch=D.captureDraftBatch(project,instruction);batch.id='draft-'+Zotero.Utilities.randomString(16);batch.previews=[];batch.status='pending';batch.createdAt=new Date().toISOString();
		for(const [index,capture]of batch.targets.entries()){
   if(signal?.aborted)throw Error('已停止；已写正文保留');const current=A.get(projectID);if(!current||D.directionSignature(current)!==batch.signature||D.directionDecisionSignature(current)!==batch.decisionSignature)throw Error('生成期间素材、方向或正文已变化，请重新生成');
			status('正在整理初稿 '+(index+1)+' / '+batch.targets.length+' · '+project.sections.find(row=>row.id===capture.sectionID)?.title);
   // A length stop on one target is recorded like a source gap: the finished
   // candidates of the other targets stay and that paragraph keeps its text.
   try{const preview=await A.previewWriting(projectID,{capture,instruction,directionChoices:decisions,modelID,thinkingLevel,signal,onProgress:status});if(signal?.aborted)throw Error('已停止；已写正文保留');batch.previews.push(preview);}catch(error){const lengthStop=['OUTPUT_LIMIT','REASONING_BUDGET_EXHAUSTED'].includes(error.code);if(signal?.aborted||error.code!=='WRITING_EVIDENCE_GAP'&&!lengthStop)throw error;batch.gaps.push({sectionID:capture.sectionID,blockID:capture.blockID,fingerprint:capture.fingerprint,reason:lengthStop?'本段候选达到输出长度上限，未保留不完整的候选；原段落不变，其他段落的候选已保留。'+error.message:error.message,code:error.code,sourceIDs:capture.sources.map(row=>row.id)});status(lengthStop?'本段候选达到输出长度上限，继续整理其他章节…':'本段来源待核对，继续整理其他章节…');}
		}
		D.assertDraftBatchCurrent(A.get(projectID),batch);delete batch.targets;return batch;
	};
})(Zotero.Research);
