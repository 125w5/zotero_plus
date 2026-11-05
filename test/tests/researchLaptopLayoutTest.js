/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Screenshots and column widths of the main pages at the window sizes of a 14 inch laptop
// at 150% (1280x752), a 16 inch laptop (1536x864) and a 27 inch monitor (2560x1440).
// Written to <data>/laptop-layout/; the checks only fail on horizontal page overflow.
describe('Main pages at laptop and desktop window sizes', function () {
	this.timeout(600000);
	const E = Zotero.Research;
	const SIZES = [[1280, 752], [1536, 864], [2560, 1440]];
	let win, folder, projectID, report = { sizes: [] };
	let wait = async (fn, label, timeout = 60000) => {
		let end = Date.now() + timeout;
		while (Date.now() < end) { if (await fn()) return; await Zotero.Promise.delay(100); }
		throw new Error('等待' + label + '超时');
	};
	let frames = () => new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
	let snapshot = async (name) => {
		await frames();
		let image = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white');
		try {
			let canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
			canvas.width = image.width; canvas.height = image.height;
			canvas.getContext('2d').drawImage(image, 0, 0);
			let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
			await IOUtils.write(PathUtils.join(folder, name + '.png'), new Uint8Array(await blob.arrayBuffer()));
		}
		finally { image.close(); }
	};
	let box = node => { if (!node || node.hidden) return null; let r = node.getBoundingClientRect(); return Math.round(r.width); };
	let overflow = doc => {
		let root = doc?.scrollingElement || doc?.documentElement;
		return root ? root.scrollWidth - root.clientWidth : 0;
	};
	let resize = async (w, h) => {
		win.restore?.();
		win.resizeTo(w, h);
		await wait(() => Math.abs(win.outerWidth - w) <= 2 || win.innerWidth > 0, '窗口尺寸', 5000);
		await Zotero.Promise.delay(500);
		await frames();
		return { requested: w + 'x' + h, inner: win.innerWidth + 'x' + win.innerHeight };
	};
	let workspace = () => win._researchLibraryWorkspace;
	let openWorkspace = async (mode) => {
		if (workspace()?.ui?.ready) await workspace().show(mode);
		else await E.openLibraryWorkspace(win, mode);
		await wait(() => workspace()?.ui?.ready && workspace().ui.activeView === mode && win.Zotero_Tabs.selectedID === 'zotero-pane', '工作区 ' + mode);
		await Zotero.Promise.delay(800);
		return workspace();
	};

	before(async function () {
		win = await loadZoteroPane();
		await E.attachWindow(win);
		folder = PathUtils.join(Zotero.DataDirectory.dir, 'laptop-layout');
		await IOUtils.makeDirectory(folder, { ignoreExisting: true });
		let p = await E.manuscripts.create('跨设备调制识别中的相位噪声补偿');
		projectID = p.id;
		await E.manuscripts.open(projectID);
		let U;
		await wait(() => (U = win.document.getElementById('manuscript-' + projectID)?.contentWindow.ManuscriptUI)?.ready, '装配页面');
		let text = '在零到二十分贝的信噪比区间内，以两分贝为步长扫描识别准确率。误差分析显示，多径衰落下的错误样本多来自时延扩展较大的信道。基线方法使用手工设计的高阶累积量特征和支持向量机分类器。';
		let materials = ['独立测试批次原始记录', '跨设备采集条件', '相位噪声补偿前后的准确率', '多径衰落下的错误样本'].map((title, i) => U.M.material({ title, summary: text.slice(0, 40 + i * 6), sourceText: text, kind: i % 2 ? 'experiment' : 'semantic' }));
		U.p.materials = materials;
		U.p.blocks = U.p.sections.slice(0, 4).flatMap((section, i) => [0, 1].map(n => U.M.block('paragraph', section.id, { text: text.repeat(1 + n), materials: [{ id: materials[(i + n) % materials.length].id, role: 'primary', revision: 1 }] })));
		U.p.ui.leftOpen = U.p.ui.rightOpen = true;
		U.changed({ editor: true });
		await U.persist();
	});
	after(async function () {
		await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2));
		win?.close();
	});

	for (let [w, h] of SIZES) {
		it(`shows the main pages without horizontal overflow at ${w}x${h}`, async function () {
			let size = await resize(w, h), row = { ...size, pages: {} }, overflowed = [];
			report.sizes.push(row);
			for (let mode of ['agent', 'search', 'ppt']) {
				let host = await openWorkspace(mode), doc = host.frame.contentDocument;
				await snapshot(`${w}x${h}-${mode}`);
				row.pages[mode] = { overflow: overflow(doc) };
				if (row.pages[mode].overflow > 1) overflowed.push(mode);
			}
			let frame = win.document.getElementById('manuscript-' + projectID), U = frame.contentWindow.ManuscriptUI, doc = frame.contentDocument;
			win.Zotero_Tabs.select(frame.parentElement.id);
			for (let step of [0, 1, 2, 3]) {
				await U.workflow.setStep(step, { focus: false });
				await Zotero.Promise.delay(900);
				await snapshot(`${w}x${h}-assembly-${step}`);
				row.pages['assembly-' + step] = {
					left: box(doc.getElementById('left')), right: box(doc.getElementById('right')),
					main: box(doc.querySelector('#workspace>main')), paper: box(doc.querySelector('#canvas>.paper')),
					zoom: U.p.ui.paperZoom || 1, overflow: overflow(doc)
				};
				if (row.pages['assembly-' + step].overflow > 1) overflowed.push('assembly-' + step);
			}
			await E.notebook.open(projectID, { win });
			await wait(() => win.document.querySelector('[id^="research-notebook-"]')?.contentWindow?.NotebookUI?.ready, '可行性页');
			await Zotero.Promise.delay(900);
			await snapshot(`${w}x${h}-feasibility`);
			await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2));
			assert.deepEqual(overflowed, [], '页面在 ' + size.inner + ' 下没有横向滚动');
		});
	}
});
