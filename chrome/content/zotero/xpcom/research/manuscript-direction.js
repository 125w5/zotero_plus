/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
	const A=E.manuscripts,D=ChromeUtils.importESModule('chrome://zotero/content/research/shared/assembly-direction.mjs');
	A.prepareDirection=async(projectID,{signal,status=()=>{},modelID=''}={})=>{
  if(signal?.aborted)throw Error('已停止方向讨论');
		const project=A.get(projectID);if(!project)throw Error('论文项目不存在');const signature=D.directionSignature(project),context=D.directionContext(project);
		context.blocks=context.blocks.map(row=>({...row,text:row.text.slice(0,1800)}));
		status('正在根据可行性方案和装配结果整理关键方向…');
		const config=modelID?{...E.settings(),model:modelID,selectedModel:true}:await E.resolveModel({...E.settings()},{signal});
  if(signal?.aborted)throw Error('已停止方向讨论');
		const response=await E.studio.request(D.DIRECTION_PROMPT,context,status,signal,{maxTokens:3500,modelConfig:config,aiAction:'evidence_organize'});
		if(signal?.aborted)throw Error('已停止方向讨论');if(D.directionSignature(A.get(projectID))!==signature)throw Error('素材或方案已变化，请重新整理方向问题');
		return {signature,questions:D.validateDirectionQuestions(response.value),answers:{},index:0,model:response.model,createdAt:new Date().toISOString()};
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
   const preview=await A.previewWriting(projectID,{capture,instruction,directionChoices:decisions,modelID,thinkingLevel,signal,onProgress:status});if(signal?.aborted)throw Error('已停止；已写正文保留');batch.previews.push(preview);
		}
		D.assertDraftBatchCurrent(A.get(projectID),batch);delete batch.targets;return batch;
	};
})(Zotero.Research);
