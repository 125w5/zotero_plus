import {installPromptTemplates, promptTemplateRequest} from './shared/prompt-templates.mjs';

// The legacy reading workspace shares the research task runner. Settings,
// skill definitions and meeting metadata are not executable chat inputs.
installPromptTemplates(document, window.parent.Zotero.Research, {
	selector:'#prompt',
	onExecute:async (input, template, request) => {
		const ui = window.EasySchUI;
		const message = async (id, fallback) => await document.l10n?.formatValue?.(id) || fallback;
		if (!ui?.agentInput || !ui.runAgentTask) throw Error(await message('prompt-action-composer-ready', '研究对话尚未准备好，请稍后重试。'));
		if (ui.busy || ui.agentRunning || ui.agentCreatingSession) throw Error(await message('prompt-action-busy', '当前研究任务尚未结束，请等待或停止。'));
		const goal = request.goal || (['source','organize'].includes(template.mode) ? ui.selection?.text || ui.current?.title : '');
		if (!goal || template.mode === 'source' && !ui.current && !ui.agentSelected) {
			input.focus();
			throw Error(await message('prompt-action-missing-goal', '请先填写研究问题，或选择一份资料。'));
		}
		const previousSessionID = ui.agentData.activeSessionID;
		let draft = ui.agentInput.value;
		ui.openAgentWorkbench(promptTemplateRequest(input, template, goal).prompt);
		ui.agentMode.value = template.mode;
		ui.agentData.mode = template.mode;
		if (ui.current) await ui.previewAgentSource({...ui.current, kind:'paper', stableID:'paper:' + ui.current.id, ...(ui.selection ? {selection:ui.selection} : {})});
		const trackDraft = () => { if (ui.agentData.activeSessionID === previousSessionID) draft = ui.agentInput.value; };
		ui.agentInput.addEventListener('input', trackDraft);
		const answers = new Set(ui.agentData.messages.filter(row => row.role === 'assistant').map(row => row.id));
		try {
			await ui.runAgentTask();
			if (!ui.agentData.messages.some(row => row.role === 'assistant' && !answers.has(row.id))) throw Error(ui.agentRunStatus.textContent || await message('prompt-action-no-result', '本次操作未返回结果，请重试。'));
		}
		finally {
			ui.agentInput.removeEventListener('input', trackDraft);
			if (ui.E.workbenchConversations && previousSessionID) await ui.E.workbenchConversations.update(previousSessionID, {draft}, {origin:'workbench'});
			if (ui.agentData.activeSessionID === previousSessionID) {
				ui.agentInput.value = draft;
				ui.updateAgentDraft();
			}
		}
	}
});
