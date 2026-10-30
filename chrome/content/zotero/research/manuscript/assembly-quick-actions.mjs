/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {promptTemplateRequest} from '../shared/prompt-templates.mjs';
import {assemblyTaskRequest} from './assembly-task-context.mjs';

const DEFAULT_TITLES = /^(?:未命名论文|新建论文|我的论文|论文装配|新论文)(?:\s*\d+)?$/u;

export function assemblyQuickActionGoal(U, input, template, request) {
	if (request.goal) return request.goal;
	const project = U.p;
	const selected = U.selectionAssistant?.getTarget?.();
	const block = project.blocks?.find(row => row.id === project.ui?.blockID);
	const materials = project.materials || [];
	const bound = (block?.materials || []).map(row => row.id);
	const material = !bound.length ? materials.find(row => row.id === U.previewMaterialID) : null;
	if (template.mode === 'source') {
		if (selected?.text) return selected.text;
		if (bound.length) return '解释当前模块关联的 ' + bound.length + ' 份资料。';
		if (material) return '当前所选资料：' + (material.title || material.summary || material.sourceText);
		if (U.conversationSession?.attachments?.some(row => row.selected !== false)) return '解释本次对话中已选的资料。';
		return '';
	}
	const topic = project.researchGoal?.trim() || (!DEFAULT_TITLES.test(project.title || '') ? project.title?.trim() : '');
	if (template.mode === 'organize') return materials.length ? (topic || '当前项目') + '，结合当前章节的用途整理已有素材。' : '';
	return topic || '';
}

export async function executeAssemblyQuickAction(U, input, template, request, {open, render, persist, status}) {
	const doc = input.ownerDocument;
	const message = async (id, fallback) => await doc.l10n?.formatValue?.(id) || fallback;
	if (U.busy || U.aiSending || U.frameworkBusy) throw Error(await message('prompt-action-busy', '当前研究任务尚未结束，请等待或停止。'));
	const goal = assemblyQuickActionGoal(U, input, template, request);
	if (!goal) {
		input.focus();
		throw Error(await message(template.mode === 'source' ? 'prompt-action-missing-source' : 'prompt-action-missing-goal', template.mode === 'source' ? '先选择要解释的资料或文字，再执行解释。' : '请先填写研究问题，或选择一份资料。'));
	}
	const session = U.conversationSession;
	if (!session || !U.sendResearchMessage) throw Error(await message('prompt-action-composer-ready', '研究对话尚未准备好，请稍后重试。'));
	const sessionID = session.id;
	let draft = input.value;
	const trackDraft = () => { if (U.conversationSession?.id === sessionID) draft = input.value; };
	input.addEventListener('input', trackDraft);
	const controls = [U.$('ask-ai'), U.$('ai-mode')].filter(Boolean);
	const disabled = controls.map(control => control.disabled);
	U.aiSending = true;
	for (const control of controls) control.disabled = true;
	U.$('cancel-ai').hidden = false;
	open();
	input.focus();
	try {
		const {prompt, context} = assemblyTaskRequest(U.p, promptTemplateRequest(input, template, goal).prompt);
		await U.sendResearchMessage(prompt, {
			sessionID, mode:template.mode, assemblyContext:context,
			modelID:session.modelID, thinkingLevel:session.thinkingLevel,
			executionMode:session.executionMode || 'auto', onProgress:text => status(text), fromComposer:true
		});
		render();
	}
	catch (error) {
		status(error.message, true);
		throw error;
	}
	finally {
		input.removeEventListener('input', trackDraft);
		U.aiSending = false;
		controls.forEach((control, index) => control.disabled = disabled[index]);
		U.$('cancel-ai').hidden = true;
		// A shortcut is a command, not a Send click: preserve the draft even
		// when the shared service clears the sent session's draft internally.
		await U.conversations.update(sessionID, {draft}, {origin:'assembly'});
		if (U.conversationSession?.id === sessionID) {
			input.value = draft;
			U.p.ui.aiDraft = draft;
			await persist();
		}
	}
}
