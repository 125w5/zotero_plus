/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {directionSignature,saveDirectionAnswer,directionDecisions,assertDraftBatchCurrent,acceptDraftBatch,revertDraftBatch} from '../shared/assembly-direction.mjs';
import {writingPreviewDiff} from '../shared/assembly-writing-preview.mjs';
export function installDirectionWorkspace(U,{el,button,persist,status,snapshot,changed,setStep}){
	const doc=U.$('canvas').ownerDocument,root=el('section',undefined,'direction-workspace');root.id='direction-workspace';U.$('recommendation').before(root);
	const guidance=el('section',undefined,'direction-guidance');U.$('right')?.append(guidance);
	root.tabIndex=-1;let busy=false,error='',progress='',controller,previewIndex=0,globalOpen=false,globalInstruction='';
	const update=()=>{render();U.selectionAssistant?.sync();};
	const task=async action=>{if(busy||U.busy)throw Error('请先完成当前任务');busy=true;U.busy=true;error='';controller=new doc.defaultView.AbortController();render();try{await persist({flush:true});if(U.saveError)throw U.saveError;await action(controller.signal);await persist({flush:true});if(U.saveError)throw U.saveError;}catch(failure){error=failure.message;status(error,true);}finally{busy=false;U.busy=false;progress='';update();}};
	const onProgress=value=>{progress=value;const node=root.querySelector('.direction-progress');if(node)node.textContent=value;};
	const prepare=()=>task(async signal=>{U.p.directionDiscussion=await U.A.prepareDirection(U.p.id,{signal,status:onProgress,modelID:U.conversationSession?.modelID});});
	const draft=(instruction='',global=false)=>task(async signal=>{const session=U.conversationSession||{};U.p.draftBatch=await U.A.prepareDraft(U.p.id,{instruction,global,signal,status:onProgress,modelID:session.modelID,thinkingLevel:session.thinkingLevel||'off'});previewIndex=0;});
	function renderPreview(host,batch){
		const previews=batch.previews||[];if(!previews.length)return;let stale='';if(batch.status==='pending')try{assertDraftBatchCurrent(U.p,batch);}catch(failure){stale=failure.message;}
		previewIndex=Math.min(previewIndex,previews.length-1);const preview=previews[previewIndex],section=U.p.sections.find(row=>row.id===preview.sectionID),nav=el('div',undefined,'draft-preview-navigation');host.append(nav);
		const previous=button('上一段',()=>{previewIndex--;render();},nav);previous.disabled=previewIndex===0;nav.append(el('strong',(section?.title||'正文')+' · '+(previewIndex+1)+' / '+previews.length));const next=button('下一段',()=>{previewIndex++;render();},nav);next.disabled=previewIndex===previews.length-1;
		const variants=el('div',undefined,'direction-options');variants.setAttribute('role','tablist');host.append(variants);for(const row of preview.variants){const control=button(row.label,()=>{preview.selectedVariantID=row.id;persist();render();},variants);control.setAttribute('role','tab');control.setAttribute('aria-selected',String(row.id===preview.selectedVariantID));}
		const variant=preview.variants.find(row=>row.id===preview.selectedVariantID)||preview.variants[0],diff=el('div',undefined,'draft-document-diff');for(const part of writingPreviewDiff(preview.capture.before?.text||'',variant.text)){const node=el(part.kind==='delete'?'del':part.kind==='insert'?'ins':'span',part.text);diff.append(node);}host.append(diff);
		const bar=el('div',undefined,'direction-actions');host.append(bar);if(stale)host.append(el('p',stale,'direction-error'));
		if(batch.status==='pending'){
			button('保留原文',async()=>{batch.status='rejected';await persist();render();},bar);
			const accept=button('保留整篇更改',async()=>{snapshot();acceptDraftBatch(U.p,batch,{createBlock:U.M.block});changed({editor:true});await persist({flush:true});if(U.saveError)throw U.saveError;await setStep(2);status('初稿已保存，可选段微调或撤回本次更改');},bar,'direction-primary');accept.disabled=!!stale||busy;
		}else if(batch.status==='accepted')button('撤回本次整篇更改',async()=>{snapshot();revertDraftBatch(U.p,batch);changed({editor:true});await persist({flush:true});render();},bar);
	}
	function render(){
		const stage=U.p.ui.step,batch=U.p.draftBatch,discussion=U.p.directionDiscussion,show=stage<3;root.hidden=!show;guidance.hidden=stage!==1;guidance.replaceChildren();
		if(stage===1){const preparation=U.p.researchPreparation||{};guidance.append(el('h3','写作依据'));for(const [label,value]of [['研究问题',preparation.researchGoal||U.p.researchGoal||U.p.title],['资源与限制',preparation.resourceConstraints],['已确认的方向',directionDecisions(discussion).map(row=>[row.choice,row.detail].filter(Boolean).join('；')).join('\n')]])if(value){const card=el('section');card.append(el('strong',label),el('p',value));guidance.append(card);}const plan=el('button','查看可行性方案');plan.type='button';plan.onclick=()=>U.E.notebook.open(U.p.id).catch(failure=>status(failure.message,true));guidance.append(plan);}
		root.classList.toggle('direction-compact',stage===0||stage===2&&batch?.status!=='pending');U.$('canvas').hidden=stage===1;root.replaceChildren();if(!show)return;
		if(stage===0){const bar=el('div',undefined,'direction-actions');root.append(bar);bar.append(el('span','按章节组织素材，保留完整上下文。','direction-intro'));button('导入语料库',()=>U.E.openResearchResources(doc.defaultView.parent,{projectID:U.p.id}),bar);button('讨论方向',()=>setStep(1),bar,'direction-primary');return;}
		if(stage===2&&batch?.status!=='pending'&&!busy){const bar=el('div',undefined,'direction-actions');root.append(bar);bar.append(el('span','选中文字，在右侧讨论修改。','direction-intro'));button('整篇调整',()=>{globalOpen=!globalOpen;render();},bar);if(batch?.status==='accepted')button('撤回整篇更改',async()=>{snapshot();revertDraftBatch(U.p,batch);changed({editor:true});await persist({flush:true});render();},bar);button('内容导出',()=>setStep(3),bar,'direction-primary');if(globalOpen){const input=el('textarea');input.rows=2;input.placeholder='例如：精简引言，按研究问题—缺口—贡献重新组织…';input.value=globalInstruction;input.setAttribute('aria-label','整篇调整要求');input.oninput=()=>globalInstruction=input.value;root.append(input);button('准备整篇修改候选',()=>draft(input.value,true),root,'direction-primary');}return;}
		const head=el('header',undefined,'direction-heading');head.append(el('div',undefined,'direction-title'));head.firstChild.append(el('small','论文装配 · '+(stage===1?'方向讨论':'初稿候选')),el('h2',batch?.status==='pending'?'比较初稿，选择保留的版本':'确认论文的论证方向'));root.append(head);
		const notice=el('p',busy?progress:'','direction-progress');notice.setAttribute('role','status');root.append(notice);if(error)root.append(el('p',error,'direction-error'));
		if(busy){button('停止',()=>controller?.abort(),head);return;}
		if(batch?.status==='pending'){renderPreview(root,batch);return;}
		if(!discussion){root.append(el('p','根据当前章节、已选素材和可行性方案，逐个确认影响论文主线的关键选择。','direction-intro'));button('开始方向讨论',prepare,root,'direction-primary');return;}
		if(discussion.signature!==directionSignature(U.p)){root.append(el('p','装配内容或可行性方案已修改，请按当前版本重新讨论。','direction-intro'));button('更新方向问题',prepare,root,'direction-primary');const history=el('details');history.append(el('summary','上次已确认的方向'));for(const row of directionDecisions(discussion))history.append(el('p',row.question+'：'+[row.choice,row.detail].filter(Boolean).join('；')));root.append(history);return;}
		const index=Math.min(discussion.index||0,discussion.questions.length),question=discussion.questions[index];
		if(question){
			root.append(el('span','问题 '+(index+1)+' / '+discussion.questions.length,'direction-count'),el('h3',question.question));if(question.reason)root.append(el('p',question.reason,'direction-intro'));
			discussion.responseDrafts||={};const answer=discussion.responseDrafts[question.id]||discussion.answers?.[question.id],options=el('div',undefined,'direction-options');options.setAttribute('role','radiogroup');options.setAttribute('aria-label','选择研究方向');root.append(options);let selected=answer?.option??null;
			const remember=()=>{discussion.responseDrafts[question.id]={option:selected,detail:detail.value};persist();};
			for(const [option,label]of question.options.entries()){const control=button(label,()=>{selected=option;for(const row of options.children)row.setAttribute('aria-checked',String(Number(row.dataset.option)===selected));remember();},options,'direction-option');control.dataset.option=String(option);control.setAttribute('role','radio');control.setAttribute('aria-checked',String(option===selected));}
			const detail=el('textarea');detail.rows=3;detail.placeholder='也可以补充或直接写下你的方向…';detail.setAttribute('aria-label','补充研究方向');detail.value=answer?.detail||'';detail.oninput=remember;root.append(detail);const bar=el('div',undefined,'direction-actions');root.append(bar);
			if(index>0)button('上一个问题',()=>{discussion.index=index-1;persist();render();},bar);
			button(index===discussion.questions.length-1?'确认，准备初稿':'确认并继续',async()=>{saveDirectionAnswer(discussion,question.id,selected,detail.value);await persist({flush:true});if(U.saveError)throw U.saveError;if(discussion.index===discussion.questions.length)return draft();render();},bar,'direction-primary');
		}else{root.append(el('h3','方向已确认'));for(const row of directionDecisions(discussion)){const card=el('section',undefined,'direction-answer');card.append(el('strong',row.question),el('p',[row.choice,row.detail].filter(Boolean).join('；')));root.append(card);}const bar=el('div',undefined,'direction-actions');root.append(bar);button('调整方向',()=>{discussion.index=0;persist();render();},bar);button('生成初稿候选',()=>draft(),bar,'direction-primary');if(batch?.status==='accepted')renderPreview(root,batch);}
	}
	U.directionWorkspace={render,prepareDraft:draft,globalRevision:async()=>{globalOpen=true;await setStep(2);root.querySelector('textarea')?.focus();}};
	return U.directionWorkspace;
}
