/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
	E.readChartData = async file => {
		if ((await IOUtils.stat(file)).size > 1000000) throw new Error('数据文件超过 1 MB');
		let value = JSON.parse(await IOUtils.readUTF8(file));
		if (!Array.isArray(value) || value.length > 20) throw new Error('数据格式应为数据集数组，最多 20 组');
		return value;
	};
	E.runArtifactEngine = async function (request, onStatus = () => {}) {
		let command = Zotero.Prefs.get('extensions.easysch.engineNode', true);
		let entry = Zotero.Prefs.get('extensions.easysch.engineEntry', true);
		if (!command || !entry || !await IOUtils.exists(command) || !await IOUtils.exists(entry)) throw new Error('产物引擎未配置，请运行 scripts/setup-research-engine.ps1 后用工作台启动器启动');
		let { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
		let proc = await Subprocess.call({ command, arguments: [entry], stderr: 'pipe' });
		let result, failure, remainder = '';
		let timer = E.setTimeout(() => proc.kill(), 150000);
		try {
			let output = (async () => {
				let chunk;
				while ((chunk = await proc.stdout.readString())) {
					remainder += chunk;
					let lines = remainder.split('\n'); remainder = lines.pop();
					for (let line of lines) {
						if (!line.trim()) continue;
						let event = JSON.parse(line);
						if (event.type === 'result') result = event.value;
						if (event.type === 'error') failure = event.message;
						if (event.type === 'progress') onStatus(`${event.stage} · ${event.status}`);
					}
				}
			})();
			let errors = (async () => { while (await proc.stderr.readString()) { /* Drain without exposing private process details. */ } })();
			await proc.stdin.write(JSON.stringify(request)); await proc.stdin.close();
			let [status] = await Promise.all([proc.wait(), output, errors]);
			if (status.exitCode || failure || !result) throw new Error(failure || '产物引擎失败或超时；原文未修改');
			return result;
		}
		finally { E.clearTimeout(timer); }
	};
	E.planPresentation = async function (meeting, onStatus) {
		let assembly = await E.runArtifactEngine({ operation: 'prompt' });
		let config = E.settings(), endpoint = E.core.endpoint(config.endpoint);
		let key = await E.credentials.get(endpoint);
		let win = Zotero.getMainWindow(), abort = new win.AbortController();
		let timer = E.setTimeout(() => abort.abort(), 120000);
		try {
			onStatus('正在规划页面与方法图…');
			let response = await win.fetch(endpoint + '/chat/completions', { method: 'POST', redirect: 'error', signal: abort.signal,
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
				body: JSON.stringify({ model: config.model, temperature: 0.2, max_tokens: 7000,
					...(new URL(endpoint).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' }, response_format: { type: 'json_object' } } : {}),
					messages: [{ role: 'system', content: assembly.sections.map(s => s.text).join('\n\n') }, { role: 'user', content: JSON.stringify({
						title: meeting.title, minutes: meeting.minutes, outline: meeting.outline.result, datasets: meeting.datasets || [],
						sources: meeting.outline.sources.map(s => ({ id: s.id, label: s.label, text: s.text.slice(0, 4000) })) }) }] }) });
			if (!response.ok) throw new Error(`页面规划接口返回 HTTP ${response.status}`);
			let payload = await response.json();
			let plan = JSON.parse(payload.choices[0].message.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
			if (!Array.isArray(plan.slides) || !plan.slides.length || plan.slides.length > 40) throw new Error('无效页面规划');
			await E.runArtifactEngine({ operation: 'validate', plan, evidence: meeting.outline.sources });
			await E.store.update(s => { s.meetings[meeting.id].slidePlan = plan; });
			return plan;
		}
		finally { E.clearTimeout(timer); }
	};
})(EasySch);
