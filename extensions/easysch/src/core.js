/* Pure domain functions shared by the Zotero runtime and regression tests. */
(function (E) {
	let C = E.core = {};
	C.defaults = {
		endpoint: '', model: '', pandoc: '', csl: '', referenceDoc: '', latexTemplate: '',
		template: '分析创新点、研究问题、实验数据来源、实验方法、基线与结果对比、局限和复现条件。区分作者主张与证据。',
		language: '简体中文', documentLanguage: 'en-US'
	};
	C.escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	}[c]));
	C.paperKey = item => `${item.libraryID}:${item.key}`;
	C.citeKey = item => `ES${item.libraryID}_${item.key}`;
	C.endpoint = value => {
		let url = new URL(String(value).trim());
		if (url.username || url.password || url.search || url.hash) {
			throw new Error('接口地址不能包含密码、查询参数或片段');
		}
		if (url.protocol !== 'https:' && !(url.protocol === 'http:'
			&& ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
			throw new Error('远程接口必须使用 HTTPS；本机接口可使用 HTTP');
		}
		return url.href.replace(/\/$/, '').replace(/\/chat\/completions$/, '');
	};
	C.validateResult = (raw, sources, mode) => {
		let cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
		let result;
		try { result = JSON.parse(cleaned); }
		catch (_) { throw new Error('模型未返回有效 JSON；请换用支持结构化输出的模型或重试'); }
		if (!Array.isArray(result.sections) || !result.sections.length || result.sections.length > 30) {
			throw new Error('模型分析缺少有效章节');
		}
		let allowed = new Set(sources.map(s => s.id));
		let sections = result.sections.map(section => {
			if (typeof section.heading !== 'string' || typeof section.body !== 'string'
				|| !section.body.trim() || !Array.isArray(section.sources)) {
				throw new Error('模型章节格式错误');
			}
			if (section.sources.some(id => !allowed.has(id))) {
				throw new Error('模型引用了不存在的证据，结果未保存；请重试');
			}
			return { heading: section.heading.slice(0, 200), body: section.body.slice(0, 16000),
				sources: [...new Set(section.sources)] };
		});
		let questions = Array.isArray(result.questions)
			? result.questions.filter(q => typeof q === 'string' && q.trim()).slice(0, 4) : [];
		if (mode === 'translate' && questions.length < 2) {
			throw new Error('翻译结果缺少至少两个后续问题，请重试');
		}
		return { sections, questions, keywords: Array.isArray(result.keywords)
			? result.keywords.filter(k => typeof k === 'string').slice(0, 15) : [] };
	};
	C.resultMarkdown = record => record.result.sections.map(s => {
		let refs = s.sources.map(id => {
			let source = record.sources.find(x => x.id === id);
			return source ? `[${id}](${source.uri})` : '';
		}).join(' ');
		return `## ${s.heading}\n\n${s.body}\n\n${refs || '待验证推断：未附原文证据。'}`;
	}).join('\n\n');
	C.graph = papers => {
		let edges = [];
		for (let i = 0; i < papers.length; i++) {
			for (let j = i + 1; j < papers.length; j++) {
				let a = papers[i], b = papers[j];
				let shared = a.tags.filter(t => b.tags.includes(t));
				let related = a.libraryID === b.libraryID && (a.related.includes(b.key) || b.related.includes(a.key));
				if (shared.length || related) edges.push({ from: a.id, to: b.id,
					label: related ? 'Zotero 相关条目' : shared.join('、'), weight: shared.length + Number(related) });
			}
		}
		return { nodes: papers, edges };
	};
	C.lint = (markdown, knownKeys) => {
		let issues = [];
		let codeFree = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
		let dollars = codeFree.match(/(?<!\\)\$/g) || [];
		if (dollars.length % 2) issues.push('数学公式的 $ 分隔符未成对；请检查公式。');
		let keys = [...codeFree.matchAll(/(?:\[|;\s*|\s)-?@([\w:.-]+)/g)].map(m => m[1]);
		for (let key of new Set(keys)) {
			if (!knownKeys.includes(key)) issues.push(`引用键 ${key} 不在当前选中文献中。`);
		}
		if (/\\(?:documentclass|begin\{document\})/.test(codeFree)) issues.push('编辑器使用 Markdown；完整 LaTeX 文档请通过期刊模板导出。');
		if (/!\[[^\]]*\]\(https?:/i.test(markdown)) issues.push('图片使用远程地址；投稿前请准备本地高分辨率图片。');
		if (/\b(?:TODO|TBD)\b|待补充|待核验/.test(markdown)) issues.push('仍有待补充或待核验内容。');
		return issues;
	};
	C.task = (title, due) => {
		if (!String(title).trim()) throw new Error('请输入任务名称');
		if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due)
			|| new Date(`${due}T00:00:00Z`).toISOString().slice(0, 10) !== due)) {
			throw new Error('日期无效');
		}
		return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
			title: String(title).trim().slice(0, 300), due, done: false };
	};
	C.pandocArgs = ({ input, output, format, bibliography, csl, referenceDoc, latexTemplate, resourcePath }) => {
		if (!['docx', 'latex', 'pptx'].includes(format)) throw new Error('不支持的导出格式');
		let args = ['--from=markdown+tex_math_dollars', '--standalone', '--to=' + format,
			'--output', output, '--resource-path', resourcePath, '--bibliography', bibliography, '--citeproc'];
		if (csl) args.push('--csl', csl);
		if (format === 'docx' && referenceDoc) args.push('--reference-doc', referenceDoc);
		if (format === 'latex' && latexTemplate) args.push('--template', latexTemplate);
		if (format === 'pptx') args.push('--slide-level=2');
		args.push(input);
		return args;
	};
})(EasySch);
