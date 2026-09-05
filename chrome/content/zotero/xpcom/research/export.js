(function (E) {
	E.pick = async function (win, title, mode, extension) {
		let { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
		let fp = new FilePicker();
		fp.init(win, title, mode === 'folder' ? fp.modeGetFolder : fp.modeOpen);
		if (extension) fp.appendFilter(extension.toUpperCase(), '*.' + extension);
		if (await fp.show() === fp.returnCancel) return null;
		return fp.file;
	};
	E.exportDocument = async function ({ folder, title, markdown, papers, format, record }) {
		if (!markdown.trim()) throw new Error('请先输入或生成正文');
		if (!['markdown', 'docx', 'latex', 'pptx'].includes(format)) throw new Error('不支持的格式');
		let settings = E.settings();
		if (format !== 'markdown' && (!settings.pandoc || !await IOUtils.exists(settings.pandoc))) {
			throw new Error('请在设置中选择已安装的 Pandoc 可执行文件');
		}
		let name = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/, '').slice(0, 70) || 'manuscript';
		// Each export gets its own directory; never replace a previous submission.
		let dir = PathUtils.join(folder, name + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
		await IOUtils.makeDirectory(dir);
		let input = PathUtils.join(dir, 'manuscript.md');
		let bibliography = PathUtils.join(dir, 'references.json');
		let yaml = `---\ntitle: ${JSON.stringify(title)}\nlang: ${JSON.stringify(settings.documentLanguage)}\n---\n\n`;
		await IOUtils.writeUTF8(input, yaml + markdown);
		await IOUtils.writeUTF8(bibliography, JSON.stringify(await E.library.bibliography(papers), null, 2));
		if (record) await IOUtils.writeUTF8(PathUtils.join(dir, 'evidence.json'), JSON.stringify(record, null, 2));
		for (let [field, file] of Object.entries({ csl: 'journal.csl', referenceDoc: 'reference.docx', latexTemplate: 'journal-template.tex' })) {
			if (settings[field]) {
				let target = PathUtils.join(dir, file);
				await IOUtils.copy(settings[field], target);
				settings[field] = target;
			}
		}
		await IOUtils.writeUTF8(PathUtils.join(dir, 'export.json'), JSON.stringify({ version: 1,
			createdAt: new Date().toISOString(), format, documentLanguage: settings.documentLanguage,
			citations: papers.map(p => ({ key: p.citeKey, libraryID: p.libraryID, itemKey: p.key, title: p.title })) }, null, 2));
		let report = E.core.lint(markdown, papers.map(p => p.citeKey));
		let instructions = 'EasySch 导出包\n\nreferences.json 中的 ES 引用键对应编辑器的 [@ES…]。\n'
			+ '普通 DOCX 的 CSL 引文是静态文本，不是 Zotero Word 动态域。需要动态引文时请使用 Zotero Word 插件。\n'
			+ 'LaTeX 默认使用 citeproc 格式化引用；可继续套用期刊模板。\n'
			+ '如需 BibLaTeX，使用工作台的独立导出操作。其键由所选 translator 生成，与 ES 键不同。\n'
			+ '原文证据链接仅指向本机 Zotero 文献；投稿前请核对并按需要移除。\n\n格式检查\n'
			+ (report.join('\n') || '自动检查未发现问题，仍需人工核对目标期刊规范。');
		await IOUtils.writeUTF8(PathUtils.join(dir, 'README.txt'), instructions);
		if (format === 'markdown') return { path: input, warnings: report };
		let extension = format === 'latex' ? 'tex' : format;
		let output = PathUtils.join(dir, 'manuscript.' + extension);
		let args = E.core.pandocArgs({ input, output, format, bibliography, resourcePath: folder, ...settings });
		let { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
		let proc = await Subprocess.call({ command: settings.pandoc, arguments: args, stderr: 'pipe' });
		let read = async pipe => { let result = '', chunk; while ((chunk = await pipe.readString())) result += chunk; return result; };
		let [, stderr, status] = await Promise.all([read(proc.stdout), read(proc.stderr), proc.wait()]);
		if (status.exitCode !== 0) throw new Error(`Pandoc 转换失败（${status.exitCode}）：${stderr.slice(0, 1800)}`);
		if (!await IOUtils.exists(output)) throw new Error('Pandoc 未生成输出文件');
		if (stderr.trim()) report.push(stderr.trim());
		return { path: output, warnings: report };
	};
})(EasySch);
