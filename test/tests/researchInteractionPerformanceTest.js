/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* global describe, it, before, after, afterEach, assert, loadZoteroPane */
describe('Research native interaction performance in a large workspace', function () {
	this.timeout(240000);
	const E = Zotero.Research;
	const PREFIX = 'perf-ix-';
	const BIG_ID = 'perf-ix-manuscript-big';
	const TYPE_BLOCK_ID = 'perf-ix-block-big-0000';
	const PHASE_QUERY = '相位噪声补偿';
	const TARGET_BYTES = 40 * 1024 * 1024;
	const FREEZE_MS = 1000;
	const TAIL_MS = 900;
	const SAVED_LABEL = '已保存到本机';
	const SAVING_LABEL = '保存中…';
	// Generous ceilings: about twice the longest wait the existing research
	// suites allow for the same route, plus room for a 40 MiB workspace.
	let LIMITS = { coldOpen: 45000, switchPage: 20000, openProject: 60000, stage: 20000, typing: 45000, material: 20000, notebookOpen: 45000, notebookTyping: 30000, storage: 30000 };
	let { setTimeout: timerSetTimeout, clearTimeout: timerClearTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
	let win, folder, workspacePath, scopeKey = '', scopeSessionID = '';
	let now = () => window.performance.now();
	let stubs = [], commits = [], offCommits = null, cleanup = {}, phaseIDs = new Set();
	let counters = { model: 0, network: 0, blocked: [], prompts: [], saveStarted: 0, saveDone: 0, saveMs: 0 };
	let report = {
		type: '大工作区原生交互性能：真实 Gecko 界面与合成数据；模型、联网与提示框为受控桩',
		startedAt: new Date().toISOString(),
		workspace: {},
		setup: {},
		limitsMs: LIMITS,
		limitBasis: '总耗时上限约为现有研究套件同类等待的两倍：工作区框架探测 20 s（R/shared/library-workspace.mjs），researchLibraryWorkspace、researchAssemblyWorkflow、researchManualAuthoring、researchMaterialBrowser 的等待循环 16-60 s，再为 40 MiB 工作区留余量。',
		freezeThresholdMs: FREEZE_MS,
		heartbeatMethod: {
			window: 'win.setInterval(10 ms)，与 researchStoragePerformanceTest 相同。每个间隔按结束时刻归入 main（触发到就绪）或 tail（就绪后到防抖保存写完）。',
			control: 'Timer.sys.mjs 的链式 setTimeout(10 ms)：不属于任何窗口的 nsITimer，不受窗口后台节流，但与窗口心跳在同一主线程，真正的阻塞会同时推迟两者。',
			frames: '同时计数 requestAnimationFrame；隐藏或被遮挡的窗口会停掉刷新驱动，帧数接近 0 表示页面没有实际绘制。',
			throttleRule: '窗口心跳 p50 > max(30 ms, 4 × 对照 p50)，或窗口超过 100 ms 的间隔比对照多 3 次以上且超过两倍，记为 throttleSuspected：这时窗口数字反映节流，应看 heartbeat.control。',
			assertion: '卡死判定用 effectiveMaxGapMs = min(窗口最大间隔, 对照最大间隔)，覆盖 main 与 tail。真正的主线程阻塞会让两者都变大，只有窗口被节流时不会误报。'
		},
		environment: {},
		calibration: [],
		operations: [],
		tests: [],
		cleanup: {},
		limitations: []
	};
	report.limitations.push(
		'工作区为合成数据：按产品接口与现有测试夹具的数据形状写入（manuscripts、researchMaterials、researchNotebooks、researchWorkbench、papers），内容由固定种子生成，不读取用户的真实 workspace.json。',
		'模型请求、联网检索、PDF 与图片整理、中文简述生成均为受控桩，调用次数见 counters；fetch 与 Zotero.HTTP.request 对外部主机一律拒绝并计数。',
		'输入用 beforeinput + execCommand(insertText) 或 input 事件逐字模拟，不是真实输入法组合；Services.prompt 的 alert/confirm 被替换，防止模态框挂住套件。',
		'心跳可能在隐藏或未激活的窗口里被节流：同时运行不受窗口节流的 Timer.sys.mjs 对照心跳并记录 rAF 帧数、document.hidden 与 hasFocus，判定方法见 heartbeatMethod。',
		'素材列表的分批加载由 IntersectionObserver 驱动；窗口不绘制时可能不加载下一批，此时 extras.appended 为 false 只说明这一点，不判失败。',
		'耗时受本机负载、磁盘与杀毒扫描影响。只有主线程间隔超过 1000 ms 或总耗时超过宽松上限才判失败，其余数字只记录。'
	);
	let sleep = ms => new Promise(resolve => timerSetTimeout(resolve, ms));
	let nextFrame = () => new Promise((resolve) => {
		let timer = timerSetTimeout(resolve, 250);
		win.requestAnimationFrame(() => {
			timerClearTimeout(timer);
			resolve();
		});
	});
	let waitFor = async (test, label, { timeout = 20000, interval = 16, soft = false } = {}) => {
		let start = now();
		while (true) {
			if (await test()) return true;
			if (now() - start > timeout) {
				if (soft) return false;
				throw new Error('等待' + label + '超时（' + timeout + ' ms）');
			}
			await sleep(interval);
		}
	};
	let percentile = (values, q) => {
		if (!values.length) return 0;
		let sorted = [...values].sort((a, b) => a - b);
		return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
	};
	// Deterministic content: the same seed produces the same workspace on every run.
	let seed = 20261031;
	let random = () => {
		seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	// None of these sentences contains 相位 or 补偿, so only the seeded cards match PHASE_QUERY.
	let CN = [
		'实验采用独立采集批次划分训练集与测试集，避免同一录制片段同时出现在两侧。',
		'在零到二十分贝的信噪比区间内，以两分贝为步长扫描识别准确率。',
		'预处理先做能量归一化，再截取一千零二十四点的同相正交样本。',
		'消融实验表明去掉注意力模块后，低信噪比条件下准确率下降约四个百分点。',
		'跨设备测试使用另一批接收机数据，未做微调直接评估。',
		'作者报告的十一类调制中，高阶正交幅度调制最容易混淆。',
		'方法部分给出了卷积层与循环层的配置，学习率采用余弦退火。',
		'该结论只在仿真数据上成立，真实空口数据的验证仍待补充。',
		'误差分析显示，多径衰落下的错误样本多来自时延扩展较大的信道。',
		'引言把问题界定为非合作场景下的自动调制识别，先验信息有限。',
		'图三比较了不同训练策略在各信噪比下的表现，零分贝附近差异最大。',
		'作者在嵌入式平台上测得单次推理延迟约三毫秒，未报告功耗。',
		'我需要补充独立批次的重复实验，并说明接收机之间的频偏差异。',
		'这一段只是相关工作的背景介绍，不应作为本文实验结果的证据。',
		'数据集包含十一种调制方式，每个信噪比采集一千个样本。',
		'讨论部分指出样本长度对短时信号的识别影响明显。',
		'基线方法使用手工设计的高阶累积量特征和支持向量机分类器。',
		'我的初步想法是先确认数据划分不泄漏，再比较网络深度对延迟的影响。'
	];
	let EN = [
		'The recognition accuracy is reported over a sweep from 0 dB to 20 dB in 2 dB steps.',
		'Each experiment is repeated five times with independent random seeds.',
		'The baseline uses handcrafted cumulant features with a support vector classifier.',
		'Cross-device evaluation reuses the trained weights without any fine-tuning.',
		'Ablation removes the attention block and reports the change at low SNR.',
		'The authors note that the conclusion is limited to simulated channels.'
	];
	let TOPICS = ['调制识别', '低信噪比', '跨设备验证', '消融实验', '多径衰落', '推理延迟', '数据划分', '注意力模块'];
	let pick = list => list[Math.floor(random() * list.length)];
	let text = (length, english = 0.15) => {
		let out = '';
		while (out.length < length) out += random() < english ? pick(EN) + ' ' : pick(CN);
		return out;
	};
	const EPOCH = Date.UTC(2026, 9, 1, 8, 0, 0);
	let ago = minutes => new Date(EPOCH - minutes * 60000).toISOString();
	let pad = n => String(n).padStart(4, '0');
	let withPhase = (body, on) => (on ? body.slice(0, 60) + '本段记录' + PHASE_QUERY + '在低信噪比下的效果。' + body.slice(60) : body);
	let CATEGORIES = ['背景与问题', '方法', '实验设置', '结果', '讨论', '局限'];
	let KINDS = ['semantic', 'annotation', 'experiment', 'note'];
	let card = (id, index, phase, owner) => {
		let M = E.manuscripts.model, sourceText = withPhase(text(500 + Math.floor(random() * 700)), phase);
		let m = M.material({
			id,
			kind: KINDS[index % KINDS.length],
			title: (phase ? PHASE_QUERY + '实验记录 ' : TOPICS[index % TOPICS.length] + ' · 素材 ') + (index + 1),
			summary: withPhase(text(120 + Math.floor(random() * 120), 0), phase),
			category: CATEGORIES[index % CATEGORIES.length],
			sourceRecordID: owner + '-record-' + index,
			explicitTags: [TOPICS[index % TOPICS.length], TOPICS[(index + 3) % TOPICS.length]],
			verification: index % 5 ? 'unverified' : 'verified',
			paperTitle: 'Synthetic study ' + (index % 97),
			createdAt: ago(index * 7),
			anchor: { sourceText }
		});
		if (phase) phaseIDs.add(id);
		return m;
	};
	let libraryCard = (index) => {
		let id = PREFIX + 'asset-' + pad(index), m = card(id, index, index % 9 === 4, PREFIX + 'library');
		m.assetID = id;
		return m;
	};
	let SECTION_TOPICS = ['研究背景', '问题定义', '相关工作', '信号模型', '数据采集', '数据划分', '预处理', '网络结构', '训练策略', '基线方法', '评价指标', '主要结果', '低信噪比分析', '跨设备验证', '消融实验', '误差分析', '推理延迟', '讨论', '局限', '结论'];
	// The large project: 36 chapters, 520 body blocks, 400 project materials.
	let buildBigProject = () => {
		let M = E.manuscripts.model, p = M.createProject('跨设备调制识别中的' + PHASE_QUERY + '（大项目性能验收）', 'method');
		p.id = BIG_ID;
		p.sections = Array.from({ length: 36 }, (_, i) => ({
			id: PREFIX + 'section-big-' + pad(i),
			title: '第' + (i + 1) + '章 ' + SECTION_TOPICS[i % SECTION_TOPICS.length] + (i >= SECTION_TOPICS.length ? '（续）' : ''),
			conclusion: ''
		}));
		p.materials = Array.from({ length: 400 }, (_, i) => card(PREFIX + 'material-big-' + pad(i), i, i % 10 === 3, BIG_ID));
		let blocks = [], used = new Set();
		for (let [s, section] of p.sections.entries()) {
			let pool = p.materials.filter((_, i) => i % p.sections.length === s), count = s < 16 ? 15 : 14;
			for (let j = 0; j < count; j++) {
				let assembly = j % 5 === 1 || j % 5 === 3, link = pool[(j >> 1) % Math.max(1, pool.length)];
				let materials = (assembly || j % 4 === 2) && link ? [{ id: link.id, role: assembly ? 'primary' : 'support', revision: 1 }] : [];
				for (let row of materials) used.add(row.id);
				blocks.push(M.block('paragraph', section.id, {
					id: PREFIX + 'block-big-' + pad(blocks.length),
					text: assembly && j % 2 ? '' : text(assembly ? 160 : 220 + Math.floor(random() * 300)),
					assembly,
					materials,
					claim: j % 8 === 6,
					review: j % 8 === 6 ? 'missing' : 'verified'
				}));
			}
		}
		// Every project material is placed at least once.
		let spare = p.materials.filter(m => !used.has(m.id));
		for (let [i, m] of spare.entries()) blocks[(i * 7 + 5) % blocks.length].materials.push({ id: m.id, role: 'support', revision: 1 });
		p.blocks = blocks;
		Object.assign(p.ui, { step: 0, left: 'materials', leftOpen: true, rightOpen: true, aiOpen: false, sectionID: p.sections[0].id, blockID: TYPE_BLOCK_ID, scrollTop: 0, caret: 0, surfaceVersion: 3, assemblyFlowVersion: 2, leftWidth: 360, rightWidth: 360 });
		p.ui.catalog = { topic: BIG_ID, type: '', sort: 'relevance', selection: [] };
		p.researchGoal = '在跨设备与低信噪比条件下验证' + PHASE_QUERY + '对调制识别的作用';
		p.revision = 1;
		p.createdAt = ago(60 * 24 * 90);
		p.updatedAt = ago(5);
		return M.assertProject(p);
	};
	let buildSmallProject = (n) => {
		let M = E.manuscripts.model, p = M.createProject('合成论文项目 ' + (n + 1) + ' · ' + TOPICS[n % TOPICS.length], n % 3 ? 'imrad' : 'review');
		p.id = PREFIX + 'manuscript-' + pad(n);
		p.sections = p.sections.map((section, i) => ({ ...section, id: p.id + '-section-' + i }));
		p.materials = Array.from({ length: 4 + (n % 6) }, (_, i) => card(p.id + '-material-' + i, n * 10 + i, false, p.id));
		p.blocks = Array.from({ length: 6 + (n % 8) }, (_, i) => M.block('paragraph', p.sections[i % p.sections.length].id, {
			id: p.id + '-block-' + i,
			text: text(200 + Math.floor(random() * 250)),
			materials: i % 2 ? [{ id: p.materials[i % p.materials.length].id, role: 'support', revision: 1 }] : []
		}));
		Object.assign(p.ui, { surfaceVersion: 3, assemblyFlowVersion: 2 });
		p.researchGoal = text(60, 0);
		p.revision = 1;
		p.createdAt = ago(60 * 24 * (n + 3));
		p.updatedAt = ago(60 * (n + 1));
		return M.assertProject(p);
	};
	let notebookEntry = (id, big) => ({
		query: '',
		selectedMaterial: null,
		messages: Array.from({ length: big ? 8 : 2 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: text(i % 2 ? 400 : 80), at: ago(30 * i) })),
		versions: [],
		decisions: [],
		artifacts: [],
		workflowStage: big || id.endsWith('0') ? 'assembly' : 'feasibility',
		view: big ? 'plan' : 'read',
		aiMode: 'auto',
		ideaDraft: big ? '跨设备条件下' + PHASE_QUERY + '能否稳定提高低信噪比的识别准确率？' : text(60, 0),
		constraints: '一台接收机、两周时间、单张显卡',
		recentQueries: ['跨设备验证', '低信噪比', '消融实验']
	});
	let conversationMessages = (sessionID, count) => Array.from({ length: count }, (_, i) => {
		let message = { id: sessionID + '-m' + pad(i), role: i % 2 ? 'assistant' : 'user', at: ago((count - i) * 7) };
		if (i % 2) {
			message.text = '**要点**\n\n1. ' + text(300) + '\n2. ' + text(260) + '\n3. 变量 \\(x_i\\) 表示第 i 个采样点。' + text(200);
			message.sources = [{ id: 'source-' + i, label: 'Synthetic study ' + (i % 13) + ' · 第 ' + (i % 9 + 1) + ' 页' }];
		}
		else {
			message.text = text(60 + (i % 5) * 20, 0);
		}
		return message;
	});
	let buildConversations = () => Array.from({ length: 6 }, (_, n) => {
		let id = PREFIX + 'conversation-' + n;
		let session = { id, title: n ? '合成研究对话 ' + n : '大项目装配讨论', messages: conversationMessages(id, 40), attachments: [], mode: 'auto', draft: '', createdAt: ago(60 * 24 * (n + 1)), updatedAt: ago(10 * (n + 1)) };
		if (n) Object.assign(session, { origin: 'workbench', libraryScopeKey: scopeKey, libraryFolder: '我的文库', libraryFiles: [] });
		else Object.assign(session, { origin: 'assembly', projectID: BIG_ID });
		return session;
	});
	// A cached paper analysis entry, in the shape E.ai stores (papers[key].records).
	let paperEntry = i => ({
		records: Array.from({ length: 3 }, (_, r) => ({
			id: PREFIX + 'paper-record-' + pad(i) + '-' + r,
			at: ago(i * 11 + r),
			mode: ['summary', 'qa', 'translate'][r],
			prompt: text(120, 0),
			model: 'perf-synthetic-model',
			paperKeys: [PREFIX + 'paper-' + pad(i)],
			result: {
				sections: Array.from({ length: 6 }, (_, k) => ({ heading: TOPICS[(i + k) % TOPICS.length], body: text(900 + (k % 3) * 300), quoteIDs: ['Q' + (k + 1)] })),
				questions: [text(40, 0), text(40, 0)]
			},
			sources: Array.from({ length: 6 }, (_, k) => ({ id: 'Q' + (k + 1), label: 'Synthetic study ' + i + ' · 第 ' + (k + 1) + ' 页', text: text(1800) })),
			warnings: []
		}))
	});
	// Window heartbeat (setInterval on the measured window) plus a control
	// heartbeat on an application timer that window throttling does not touch.
	let heartbeat = () => {
		let view = win, rows = [], control = [], frames = 0, frame = 0, stopped = false, timer = 0;
		let last = now(), lastControl = last;
		let interval = view.setInterval(() => {
			let t = now();
			rows.push({ t, gap: t - last });
			last = t;
		}, 10);
		let loop = () => {
			if (stopped) return;
			let t = now();
			control.push({ t, gap: t - lastControl });
			lastControl = t;
			timer = timerSetTimeout(loop, 10);
		};
		timer = timerSetTimeout(loop, 10);
		let paint = () => {
			if (stopped) return;
			frames++;
			frame = view.requestAnimationFrame(paint);
		};
		try {
			frame = view.requestAnimationFrame(paint);
		}
		catch {}
		return {
			rows,
			control,
			get frames() {
				return frames;
			},
			stop() {
				stopped = true;
				let t = now();
				try {
					view.clearInterval(interval);
					view.cancelAnimationFrame(frame);
				}
				catch {}
				timerClearTimeout(timer);
				rows.push({ t, gap: t - last });
				control.push({ t, gap: t - lastControl });
			}
		};
	};
	let gapStats = (rows, from = -Infinity, to = Infinity) => {
		let gaps = rows.filter(row => row.t > from && row.t <= to).map(row => row.gap);
		let round = value => Math.round(value * 10) / 10;
		return {
			ticks: gaps.length,
			maxGapMs: round(gaps.length ? Math.max(...gaps) : 0),
			p50GapMs: round(percentile(gaps, 0.5)),
			p95GapMs: round(percentile(gaps, 0.95)),
			over50: gaps.filter(gap => gap > 50).length,
			over100: gaps.filter(gap => gap > 100).length,
			over300: gaps.filter(gap => gap > 300).length,
			over1000: gaps.filter(gap => gap > 1000).length,
			blockingMs: Math.round(gaps.reduce((sum, gap) => sum + Math.max(0, gap - 50), 0))
		};
	};
	let throttled = (windowStats, controlStats) => {
		if (!windowStats.ticks || !controlStats.ticks) return false;
		let p50 = windowStats.p50GapMs > Math.max(30, controlStats.p50GapMs * 4);
		let slow = windowStats.over100 > controlStats.over100 * 2 && windowStats.over100 - controlStats.over100 > 3;
		return p50 || slow;
	};
	let readSafe = (fn) => {
		try {
			return fn();
		}
		catch {
			return null;
		}
	};
	let viewport = () => ({
		innerWidth: readSafe(() => win.innerWidth),
		innerHeight: readSafe(() => win.innerHeight),
		devicePixelRatio: readSafe(() => win.devicePixelRatio),
		hidden: readSafe(() => win.document.hidden),
		visibilityState: readSafe(() => win.document.visibilityState),
		hasFocus: readSafe(() => win.document.hasFocus()),
		activeWindow: readSafe(() => Services.focus.activeWindow === win),
		windowState: readSafe(() => ({ 1: 'maximized', 2: 'minimized', 3: 'normal', 4: 'fullscreen' })[win.windowState] || String(win.windowState)),
		selectedTab: readSafe(() => win.Zotero_Tabs.selectedType + ':' + win.Zotero_Tabs.selectedID)
	});
	let commitSummary = (from, to) => {
		let rows = commits.filter(row => row.t >= from && row.t <= to), branches = {};
		for (let row of rows) {
			for (let key of row.branches) branches[key] = (branches[key] || 0) + 1;
		}
		return { count: rows.length, branches, atMs: rows.map(row => Math.round(row.t - from)) };
	};
	// Same capture as the existing research suites, written to interaction-performance/.
	let snapshot = async (name) => {
		await nextFrame();
		await nextFrame();
		let image = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white');
		try {
			let canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			canvas.getContext('2d').drawImage(image, 0, 0);
			let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
			await IOUtils.write(PathUtils.join(folder, name + '.png'), new Uint8Array(await blob.arrayBuffer()));
			return name + '.png';
		}
		finally {
			image.close();
		}
	};
	let ranked = (rows, key) => [...rows].sort((a, b) => b[key] - a[key]);
	let writeReport = async () => {
		if (!folder) return;
		let rows = report.operations;
		report.summary = rows.map(row => ({ id: row.id, label: row.label, totalMs: row.totalMs, settledMs: row.settledMs, maxGapMs: row.maxGapMs, effectiveMaxGapMs: row.effectiveMaxGapMs, p95GapMs: row.p95GapMs, over100: row.over100, over300: row.over300, throttleSuspected: row.throttleSuspected, error: row.error || null }));
		report.worstByMaxGap = ranked(rows, 'effectiveMaxGapMs').slice(0, 5).map(row => row.id + ' · ' + row.effectiveMaxGapMs + ' ms');
		report.slowest = ranked(rows, 'totalMs').slice(0, 5).map(row => row.id + ' · ' + row.totalMs + ' ms');
		report.freezes = rows.filter(row => row.effectiveMaxGapMs > FREEZE_MS).map(row => row.id);
		report.overLimit = rows.filter(row => row.totalMs > row.limitMs).map(row => row.id);
		report.counters = { modelRequests: counters.model, blockedNetworkRequests: counters.network, blockedHosts: counters.blocked.slice(0, 20), prompts: counters.prompts.slice(0, 20), projectSaves: counters.saveDone, projectSaveMs: Math.round(counters.saveMs) };
		report.updatedAt = new Date().toISOString();
		await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2));
	};
	// Wait until queued store writes and every editor's coalesced save are done.
	let settle = async (minimum = 0, timeout = 15000) => {
		if (minimum) await sleep(minimum);
		let start = now();
		while (now() - start < timeout) {
			await E.store.flush();
			let saving = [...win.document.querySelectorAll('iframe[id^="manuscript-"]')].some(frame => readSafe(() => frame.contentDocument.getElementById('save-status')?.textContent) === SAVING_LABEL);
			if (!saving && counters.saveDone >= counters.saveStarted) return true;
			await sleep(25);
		}
		return false;
	};
	// One measured operation: heartbeat from the trigger until the UI is ready
	// (main) and until its debounced saves have been written (tail).
	let measure = async (id, label, limitMs, run, { verify } = {}) => {
		await settle(150);
		win.focus();
		let entry = { id, label, limitMs, viewportBefore: viewport() }, extras = {}, failure = null, readyAt = null;
		let models = counters.model, network = counters.network, saves = counters.saveDone;
		let beat = heartbeat(), start = now();
		try {
			await run({ ready: () => {
				readyAt ??= now();
			}, extras });
		}
		catch (error) {
			failure = error;
		}
		let end = now();
		readyAt ??= end;
		let settled = await settle(TAIL_MS);
		let settledAt = now();
		beat.stop();
		let windowAll = gapStats(beat.rows), controlAll = gapStats(beat.control);
		let suspected = throttled(windowAll, controlAll);
		let effective = controlAll.ticks ? Math.min(windowAll.maxGapMs, controlAll.maxGapMs) : windowAll.maxGapMs;
		Object.assign(entry, {
			totalMs: Math.round(readyAt - start),
			settledMs: Math.round(settledAt - start),
			settled,
			maxGapMs: windowAll.maxGapMs,
			p95GapMs: windowAll.p95GapMs,
			over100: windowAll.over100,
			over300: windowAll.over300,
			effectiveMaxGapMs: effective,
			throttleSuspected: suspected,
			heartbeat: {
				window: windowAll,
				control: controlAll,
				windowMain: gapStats(beat.rows, -Infinity, readyAt),
				windowTail: gapStats(beat.rows, readyAt, Infinity),
				controlMain: gapStats(beat.control, -Infinity, readyAt),
				controlTail: gapStats(beat.control, readyAt, Infinity),
				frames: beat.frames,
				framesPerSecond: Math.round(beat.frames / Math.max(0.001, (settledAt - start) / 1000))
			},
			store: commitSummary(start, settledAt),
			projectSaves: counters.saveDone - saves,
			modelRequests: counters.model - models,
			blockedNetworkRequests: counters.network - network,
			viewportAfter: viewport(),
			extras
		});
		if (failure) entry.error = String(failure.message || failure);
		if (verify) {
			try {
				entry.verify = await verify(extras);
			}
			catch (error) {
				entry.verifyError = String(error.message || error);
			}
		}
		try {
			entry.snapshot = await snapshot(id);
		}
		catch (error) {
			entry.snapshotError = String(error.message || error);
		}
		report.operations.push(entry);
		await writeReport();
		if (failure) throw failure;
		assert.isAtMost(entry.effectiveMaxGapMs, FREEZE_MS, label + '：主线程最长间隔 ' + entry.effectiveMaxGapMs + ' ms（窗口 ' + entry.maxGapMs + ' ms，对照 ' + entry.heartbeat.control.maxGapMs + ' ms）');
		assert.isAtMost(entry.totalMs, limitMs, label + '：从触发到就绪 ' + entry.totalMs + ' ms，超过宽松上限 ' + limitMs + ' ms');
		return entry;
	};
	let placeCaretAtEnd = (node) => {
		let doc = node.ownerDocument, range = doc.createRange();
		range.selectNodeContents(node);
		range.collapse(false);
		let selection = doc.defaultView.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	};
	// The editor takes its undo snapshot in beforeinput and reads the text in input.
	let typeIntoEditable = (node, value) => {
		let doc = node.ownerDocument, view = doc.defaultView, before = node.textContent.length;
		placeCaretAtEnd(node);
		node.dispatchEvent(new view.Event('beforeinput', { bubbles: true, cancelable: true }));
		let inserted = false;
		try {
			inserted = doc.execCommand('insertText', false, value);
		}
		catch {}
		if (inserted && node.textContent.length > before) return 'execCommand';
		let selection = view.getSelection(), range = selection.rangeCount ? selection.getRangeAt(0) : null, textNode = doc.createTextNode(value);
		if (range && node.contains(range.startContainer)) range.insertNode(textNode);
		else node.append(textNode);
		placeCaretAtEnd(node);
		node.dispatchEvent(new view.Event('input', { bubbles: true }));
		return 'fallback';
	};
	let typeIntoField = (field, value) => {
		field.value += value;
		field.setSelectionRange(field.value.length, field.value.length);
		field.dispatchEvent(new field.ownerDocument.defaultView.Event('input', { bubbles: true }));
		return field.value;
	};
	let stub = (owner, key, value, { assign = false } = {}) => {
		if (!owner) return;
		stubs.push({ owner, key, value: owner[key], own: Object.hasOwn(owner, key), assign });
		owner[key] = value;
	};
	let unstub = () => {
		while (stubs.length) {
			let row = stubs.pop();
			try {
				if (row.own || row.assign) row.owner[row.key] = row.value;
				else delete row.owner[row.key];
			}
			catch (error) {
				report.cleanup.unstubError = String(error.message || error);
			}
		}
	};
	let blockedURL = (value) => {
		let url;
		try {
			url = new URL(String(value?.url || value));
		}
		catch {
			return false;
		}
		if (!['http:', 'https:'].includes(url.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
		counters.network++;
		counters.blocked.push(url.hostname);
		return true;
	};
	let guardFetch = (target) => {
		if (!target || target._perfFetchGuard) return;
		let original = target.fetch;
		let guarded = function (resource, ...rest) {
			if (blockedURL(resource)) return Promise.reject(new TypeError('交互性能验收不发起联网请求'));
			return original.call(target, resource, ...rest);
		};
		stub(target, 'fetch', guarded);
		stub(target, '_perfFetchGuard', true);
	};
	let installRuntimeGuards = () => {
		let request = Zotero.HTTP.request;
		stub(Zotero.HTTP, 'request', function (method, url, ...rest) {
			if (blockedURL(url)) return Promise.reject(new Error('交互性能验收不发起联网请求'));
			return request.call(this, method, url, ...rest);
		});
		let real = Services.prompt, note = (kind, title, message) => counters.prompts.push({ kind, title: String(title || ''), message: String(message || '').slice(0, 200) });
		let guard = {
			alert: (_parent, title, message) => note('alert', title, message),
			confirm: (_parent, title, message) => {
				note('confirm', title, message);
				return false;
			},
			confirmEx: (_parent, title, message) => {
				note('confirmEx', title, message);
				return 1;
			}
		};
		try {
			for (let key in real) {
				if (typeof real[key] === 'number') guard[key] = real[key];
			}
		}
		catch {}
		stub(Services, 'prompt', guard, { assign: true });
		guardFetch(window);
	};
	// Controlled stand-ins for every model, provider and background-index entry
	// point the measured pages can reach (same set as researchLibraryWorkspaceTest).
	let stubIf = (owner, key, value) => {
		if (owner && typeof owner[key] === 'function') stub(owner, key, value);
	};
	let installEngineStubs = () => {
		stubIf(E.studio, 'request', async () => {
			counters.model++;
			throw new Error('交互性能验收不调用模型');
		});
		stubIf(E, 'workbenchModels', async () => []);
		stubIf(E, 'recommendationFeed', async () => ({ records: [], hasMore: false, page: 1 }));
		stubIf(E, 'searchPaperPage', async () => ({ records: [], page: 1, hasMore: false }));
		stubIf(E, 'findDiscoverySources', async () => []);
		stubIf(E, 'findDiscoveryTopics', async () => []);
		stubIf(E, 'discoveryBrief', async row => ({ text: row?.abstract || '', language: 'en', translated: false }));
		stubIf(E, 'discoveryPreview', async () => null);
		stubIf(E, 'discoveryChinese', async row => ({ title: row?.title || '', summary: row?.abstract || '', translated: false }));
		stubIf(E, 'candidateMetric', async () => null);
		stubIf(E, 'completePaperMetadata', async () => {});
		stubIf(E, 'ensurePaperMetrics', async () => null);
		stubIf(E, 'queueReaderRapidReading', () => {});
		stubIf(E, 'queueReaderPreparation', () => {});
		stubIf(E.assets, 'queueImages', async () => {});
		for (let key of ['ensureChineseSummaries', 'prepareTranslation', 'queueArticle', 'indexArticle', 'queueTranslation']) stubIf(E.manuscripts, key, async () => null);
		for (let [jobID, job] of Object.entries(E.manuscripts.indexState?.() || {})) {
			if (['queued', 'running'].includes(job?.status)) E.manuscripts.cancelArticle?.(Number(jobID));
		}
		let save = E.manuscripts.save;
		stub(E.manuscripts, 'save', async (...args) => {
			counters.saveStarted++;
			let start = now();
			try {
				return await save(...args);
			}
			finally {
				counters.saveDone++;
				counters.saveMs += now() - start;
			}
		});
		offCommits = E.store.subscribe(change => commits.push({ t: now(), branches: change?.changedBranches ? [...change.changedBranches] : ['*'] }));
	};
	// Small branches are restored whole after the suite; large ones (a big cache
	// left by an earlier suite) only lose this suite's prefixed entries.
	let snapshotStore = async () => {
		let keys = [];
		await E.store.update((state) => {
			keys = Object.keys(state);
		});
		cleanup.keys = keys;
		cleanup.branches = {};
		cleanup.largeBranches = [];
		for (let key of keys) {
			let json = JSON.stringify(E.store.peek(key)) ?? 'null';
			if (json.length > 2 * 1024 * 1024) cleanup.largeBranches.push(key);
			else cleanup.branches[key] = json;
		}
	};
	let purgeSynthetic = () => E.store.update((state) => {
		for (let key of ['manuscripts', 'manuscriptTrash', 'researchNotebooks', 'manuscriptLibrary', 'researchMaterials', 'papers', 'readerNoteLinks', 'projectReadings', 'projectTaskPlans', 'manuscriptAssessments']) {
			let branch = state[key];
			if (!branch || typeof branch !== 'object') continue;
			for (let id of Object.keys(branch)) {
				if (id.startsWith(PREFIX)) delete branch[id];
			}
		}
		let workbench = state.researchWorkbench;
		if (Array.isArray(workbench?.sessions)) {
			let mine = id => typeof id === 'string' && id.startsWith(PREFIX);
			if (workbench.sessions.some(row => mine(row?.id))) workbench.sessions = workbench.sessions.filter(row => !mine(row?.id));
			for (let [scope, id] of Object.entries(workbench.scopeSessions || {})) {
				if (mine(id)) delete workbench.scopeSessions[scope];
			}
			if (mine(workbench.activeSessionID)) workbench.activeSessionID = workbench.sessions[0]?.id || '';
		}
	});
	let restoreStore = async () => {
		if (!cleanup.keys) return;
		await E.store.update((state) => {
			for (let key of Object.keys(state)) {
				if (!cleanup.keys.includes(key)) delete state[key];
			}
			for (let [key, json] of Object.entries(cleanup.branches)) {
				let value = JSON.parse(json);
				if (value === null) delete state[key];
				else state[key] = value;
			}
		});
		await purgeSynthetic();
		await E.store.flush();
	};
	// A fresh data directory has no workspace.json until the first committed write.
	let fileBytes = async () => ((await IOUtils.exists(workspacePath)) ? (await IOUtils.stat(workspacePath)).size : 0);
	let seedWorkspace = async () => {
		let seedReport = report.setup.seed = { steps: [] }, bytes = await fileBytes(), initial = bytes;
		let step = async (name, mutate) => {
			let start = now();
			await E.store.update(mutate);
			await E.store.flush();
			let after = await fileBytes();
			seedReport.steps.push({ name, ms: Math.round(now() - start), bytesAdded: after - bytes });
			bytes = after;
		};
		let conversations = buildConversations();
		scopeSessionID = conversations[1].id;
		await step('researchWorkbench', (state) => {
			let workbench = state.researchWorkbench ||= { version: 2, activeSessionID: '', sessions: [], home: {}, scopeSessions: {} };
			workbench.sessions ||= [];
			workbench.scopeSessions ||= {};
			for (let session of conversations) workbench.sessions.push(session);
			workbench.scopeSessions['project:' + BIG_ID] = conversations[0].id;
			workbench.scopeSessions['library:' + scopeKey] = scopeSessionID;
			workbench.activeSessionID = scopeSessionID;
		});
		await step('researchMaterials', (state) => {
			let library = state.researchMaterials ||= {};
			for (let i = 0; i < 1200; i++) {
				let m = libraryCard(i);
				library[m.id] = m;
			}
		});
		let big = buildBigProject(), small = Array.from({ length: 39 }, (_, n) => buildSmallProject(n));
		await step('manuscripts+researchNotebooks', (state) => {
			let manuscripts = state.manuscripts ||= {}, notebooks = state.researchNotebooks ||= {};
			for (let p of [big, ...small]) {
				manuscripts[p.id] = p;
				notebooks[p.id] = notebookEntry(p.id, p.id === BIG_ID);
			}
		});
		// The paper cache fills the rest, sized from one encoded sample entry.
		let entryBytes = new TextEncoder().encode(JSON.stringify(paperEntry(0))).length;
		let paperCount = Math.max(40, Math.min(1500, Math.ceil((TARGET_BYTES - bytes) / entryBytes)));
		await step('papers', (state) => {
			let papers = state.papers ||= {};
			for (let i = 0; i < paperCount; i++) papers[PREFIX + 'paper-' + pad(i)] = paperEntry(i);
		});
		// An app that has been open a while has frozen these caches in idle
		// slices (storage.js IDLE_FREEZE); do the same so the first list read is warm.
		seedReport.idleFreeze = [];
		for (let key of ['researchMaterials', 'manuscriptDocuments', 'manuscriptIndex', 'materialDescriptions', 'manuscriptSectionView', 'manuscriptSectionReferences']) {
			let start = now(), slices = 0, done = !E.store.freezeIdle;
			while (!done && slices < 10000) {
				let sliceStart = Date.now();
				done = E.store.freezeIdle(key, () => Date.now() - sliceStart > 8);
				slices += 1;
				await sleep(0);
			}
			seedReport.idleFreeze.push({ key, ms: Math.round(now() - start), slices });
		}
		let libraryStart = now();
		await E.manuscripts.ensureLibraryItem(BIG_ID);
		seedReport.ensureLibraryItemMs = Math.round(now() - libraryStart);
		await E.store.flush();
		let total = await fileBytes();
		report.workspace = {
			path: workspacePath,
			bytesBefore: initial,
			bytes: total,
			mebibytes: Math.round(total / 1048576 * 10) / 10,
			reference: 'docs/handoff-2026-10-30/README.md：用户真实的 workspace.json 约 45 MB',
			projects: 1 + small.length,
			bigProject: { id: BIG_ID, sections: big.sections.length, blocks: big.blocks.length, materials: big.materials.length, phaseMaterials: big.materials.filter(m => phaseIDs.has(m.id)).length },
			smallProjects: { count: small.length, blocks: small.reduce((n, p) => n + p.blocks.length, 0), materials: small.reduce((n, p) => n + p.materials.length, 0) },
			libraryCards: 1200,
			phaseQuery: PHASE_QUERY,
			phaseMatches: phaseIDs.size,
			conversations: conversations.length,
			conversationMessages: conversations.reduce((n, row) => n + row.messages.length, 0),
			notebooks: 1 + small.length,
			paperCacheEntries: paperCount,
			paperCacheRecords: paperCount * 3,
			paperEntryBytes: entryBytes,
			scopeKey,
			seedSteps: seedReport.steps
		};
	};
	// Entry points and readiness checks copied from researchLibraryWorkspaceTest.
	let workspace = () => win._researchLibraryWorkspace;
	let workspaceReady = (mode) => {
		let host = workspace(), ui = host?.ui;
		if (!host || !ui?.ready || host.mode !== mode || ui.activeView !== mode) return false;
		if (!host.frame || host.frame.inert || host.loading?.dataset.state !== 'idle') return false;
		if (win.Zotero_Tabs.selectedID !== 'zotero-pane') return false;
		if (mode === 'writing') return !!ui.$('manuscript-projects')?.querySelector('.project-card[data-project-id="' + BIG_ID + '"]');
		if (mode === 'ppt') return !!(ui.pptDraft && ui.pptAssistant);
		return true;
	};
	let ensureWorkspace = async (mode) => {
		win.focus();
		if (!workspaceReady(mode)) {
			if (workspace()?.ui?.ready) await workspace().show(mode);
			else await E.openLibraryWorkspace(win, mode);
			await waitFor(() => workspaceReady(mode), '工作区 ' + mode, { timeout: LIMITS.coldOpen });
		}
		if (mode === 'ppt') await workspace().ui.pptAssistantReady;
		await settle(300);
		return workspace().ui;
	};
	// The assembly page (researchAssemblyWorkflowTest / researchManualAuthoringTest).
	let assemblyFrame = () => win.document.getElementById('manuscript-' + BIG_ID);
	let assemblyUI = () => assemblyFrame()?.contentWindow?.ManuscriptUI;
	let ensureAssembly = async (step = 0) => {
		win.focus();
		if (!assemblyUI()?.ready) {
			await E.manuscripts.open(BIG_ID);
			await waitFor(() => assemblyUI()?.ready, '装配页面', { timeout: LIMITS.openProject });
		}
		let U = assemblyUI(), frame = assemblyFrame();
		win.Zotero_Tabs.select(frame.parentElement.id);
		if (U.p.ui.step !== step) await U.workflow.setStep(step, { focus: false });
		if (step === 0 && U.p.ui.left !== 'materials') {
			frame.contentDocument.querySelector('#left-tabs [data-view="materials"]')?.click();
			await waitFor(() => U.p.ui.left === 'materials' && frame.contentDocument.getElementById('material-search'), '素材库标签');
		}
		await settle(300);
		return U;
	};
	// The feasibility page (researchPreparationFlowTest).
	let notebookFrame = () => win.document.getElementById('research-notebook-' + BIG_ID);
	let notebookReady = () => {
		let frame = notebookFrame(), doc = frame?.contentDocument;
		return !!(frame?.contentWindow?.NotebookUI?.ready && doc.getElementById('evaluation') && !doc.getElementById('evaluation').hidden && doc.getElementById('idea'));
	};
	let ensureNotebook = async () => {
		win.focus();
		if (!notebookFrame()?.contentWindow?.NotebookUI?.ready) {
			await E.notebook.update(BIG_ID, { view: 'plan' });
			await E.notebook.open(BIG_ID, { win });
			await waitFor(() => notebookFrame()?.contentWindow?.NotebookUI?.ready, '可行性页面', { timeout: LIMITS.notebookOpen });
		}
		let frame = notebookFrame();
		win.Zotero_Tabs.select(frame.parentElement.id);
		if (frame.contentDocument.getElementById('evaluation').hidden) frame.contentDocument.getElementById('plan-tab').click();
		await waitFor(notebookReady, '可行性方案页');
		await settle(300);
		return frame;
	};
	// Idle heartbeat with no operation running: shows whether the window timer
	// itself is throttled in this run, before and after the measured operations.
	let calibrate = async (phase) => {
		let beat = heartbeat();
		await sleep(800);
		beat.stop();
		let windowStats = gapStats(beat.rows), controlStats = gapStats(beat.control);
		report.calibration.push({ phase, window: windowStats, control: controlStats, frames: beat.frames, throttleSuspected: throttled(windowStats, controlStats), renderingStopped: beat.frames < 5, viewport: viewport() });
	};
	let eraseNativeObjects = async () => {
		if (!cleanup.itemIDs || !cleanup.collectionIDs) return;
		let items = (await Zotero.DB.columnQueryAsync('SELECT itemID FROM items') || []).filter(id => !cleanup.itemIDs.has(id));
		let collections = (await Zotero.DB.columnQueryAsync('SELECT collectionID FROM collections') || []).filter(id => !cleanup.collectionIDs.has(id));
		if (items.length) await Zotero.Items.erase(items);
		if (collections.length) await Zotero.Collections.erase(collections);
		report.cleanup.erasedItems = items.length;
		report.cleanup.erasedCollections = collections.length;
	};
	before(async function () {
		try {
			folder = PathUtils.join(Zotero.DataDirectory.dir, 'interaction-performance');
			workspacePath = PathUtils.join(Zotero.DataDirectory.dir, 'easysch', 'workspace.json');
			await IOUtils.makeDirectory(folder, { ignoreExisting: true });
			installRuntimeGuards();
			installEngineStubs();
			// Session restore must not reopen research tabs from an earlier suite.
			let sessionWindows = Zotero.Session.state.windows;
			Zotero.Session.state.windows = [];
			try {
				win = await loadZoteroPane();
				await E.attachWindow(win);
			}
			finally {
				Zotero.Session.state.windows = sessionWindows;
			}
			guardFetch(win);
			if (Zotero.getMainWindow() !== win) guardFetch(Zotero.getMainWindow());
			win.Zotero_Tabs.closeAll();
			// Fit the window to this display (1280x800 logical at 150 %) and restore it afterwards.
			cleanup.geometry = { width: win.outerWidth, height: win.outerHeight, x: win.screenX, y: win.screenY };
			let display = win.screen;
			win.moveTo(display.availLeft || 0, display.availTop || 0);
			win.resizeTo(Math.min(1280, display.availWidth), Math.min(800, display.availHeight));
			win.focus();
			await sleep(400);
			cleanup.itemIDs = new Set(await Zotero.DB.columnQueryAsync('SELECT itemID FROM items') || []);
			cleanup.collectionIDs = new Set(await Zotero.DB.columnQueryAsync('SELECT collectionID FROM collections') || []);
			await snapshotStore();
			await purgeSynthetic();
			let { libraryScopeKey } = ChromeUtils.importESModule('chrome://zotero/content/research/shared/library-scope.mjs');
			scopeKey = libraryScopeKey(win.ZoteroPane.getCollectionTreeRows()) || 'L' + Zotero.Libraries.userLibraryID;
			await seedWorkspace();
			report.environment = {
				viewport: viewport(),
				screen: { width: display.width, height: display.height, availWidth: display.availWidth, availHeight: display.availHeight },
				zotero: Zotero.version,
				platform: Services.appinfo.OS,
				largeBranchesNotSnapshotted: cleanup.largeBranches
			};
			await calibrate('before-operations');
		}
		catch (error) {
			report.setupError = String(error.message || error);
			throw error;
		}
		finally {
			await writeReport();
		}
	});
	afterEach(async function () {
		report.tests.push({ name: this.currentTest.title, state: this.currentTest.state, error: this.currentTest.err?.message });
		await writeReport();
	});
	after(async function () {
		this.timeout(180000);
		let steps = report.cleanup.steps = [];
		let step = async (name, fn) => {
			try {
				await fn();
				steps.push(name);
			}
			catch (error) {
				steps.push(name + ' 失败：' + (error.message || error));
			}
		};
		if (win) await step('calibrate', () => calibrate('after-operations'));
		// Close the editors first: their close handlers save, and the restore below
		// must be the last write of this suite.
		if (win) await step('close-tabs', () => win.Zotero_Tabs.closeAll());
		await step('flush', () => settle(400, 20000));
		if (win) await step('dispose-workspace', () => workspace()?.dispose());
		await step('flush-after-dispose', () => settle(300, 20000));
		await step('restore-store', restoreStore);
		if (win && cleanup.geometry) {
			await step('restore-geometry', () => {
				win.resizeTo(cleanup.geometry.width, cleanup.geometry.height);
				win.moveTo(cleanup.geometry.x, cleanup.geometry.y);
			});
		}
		if (win) await step('close-window', () => win.close());
		await step('restore-store-again', async () => {
			await sleep(500);
			await E.store.flush();
			await restoreStore();
		});
		await step('erase-native-objects', eraseNativeObjects);
		offCommits?.();
		unstub();
		report.finishedAt = new Date().toISOString();
		await writeReport();
	});
	// Four sequential note-link writes, as in researchStoragePerformanceTest.
	let noteLinkWrites = async (tag, extras) => {
		let durations = [];
		for (let i = 0; i < 4; i++) {
			let start = now();
			await E.store.update((state) => {
				state.readerNoteLinks ||= {};
				state.readerNoteLinks[PREFIX + 'note-' + tag + '-' + i] = { noteID: -1 - i, annotationID: -100 - i, pageIndex: i, at: new Date().toISOString() };
			});
			durations.push(Math.round(now() - start));
		}
		extras.writeMs = durations;
		extras.workspaceBytes = await fileBytes();
	};
	let pageExtras = (mode, extras) => {
		let ui = workspace()?.ui;
		if (mode === 'agent') {
			extras.activeSessionID = ui?.agentData?.activeSessionID || null;
			extras.seededSessionShown = extras.activeSessionID === scopeSessionID;
			extras.transcriptNodes = ui?.agentMessages?.children.length ?? null;
			extras.transcriptChars = ui?.agentMessages?.textContent.length ?? null;
		}
		if (mode === 'writing') extras.projectCards = ui?.$('manuscript-projects')?.querySelectorAll('.project-card').length ?? null;
		if (mode === 'ppt') extras.pptDraftID = ui?.pptDraft?.id || null;
	};
	// The starting page is prepared outside the measured window.
	let switchPage = async (id, label, from, to) => {
		await ensureWorkspace(from);
		return measure(id, label, LIMITS.switchPage, async ({ ready, extras }) => {
			let button = win.document.querySelector('#easysch-home-navigation [data-page="' + to + '"]');
			assert.exists(button, '原生科研导航按钮 ' + to);
			button.click();
			await waitFor(() => workspaceReady(to), label, { timeout: LIMITS.switchPage + 5000 });
			if (to === 'ppt') await workspace().ui.pptAssistantReady;
			ready();
			pageExtras(to, extras);
		});
	};
	it('01 baseline: a small note-link write beside the large workspace keeps the main thread available', async function () {
		await measure('01-baseline-storage-write', '基线：保存一条笔记链接（共四次小写入）', LIMITS.storage, async ({ ready, extras }) => {
			await noteLinkWrites('baseline', extras);
			ready();
		});
	});
	it('02 opens the research workspace home (研究对话) from the native navigation', async function () {
		assert.exists(workspace(), '文献工作区宿主已安装');
		await measure('02-open-home', '打开研究工作区首页（研究对话）', LIMITS.coldOpen, async ({ ready, extras }) => {
			extras.coldFrame = !workspace().ui?.ready;
			win.document.querySelector('#easysch-home-navigation [data-page="agent"]').click();
			await waitFor(() => workspaceReady('agent'), '研究工作区首页', { timeout: LIMITS.coldOpen + 5000 });
			ready();
			pageExtras('agent', extras);
		});
	});
	it('03 switches from the home page to literature search', async function () {
		await switchPage('03-home-to-search', '首页 → 文献检索', 'agent', 'search');
	});
	it('04 switches from literature search to the group-meeting PPT', async function () {
		await switchPage('04-search-to-ppt', '文献检索 → 组会 PPT', 'search', 'ppt');
	});
	it('05 switches from the group-meeting PPT back to the home page', async function () {
		await switchPage('05-ppt-to-home', '组会 PPT → 首页', 'ppt', 'agent');
	});
	it('06 switches from the home page to paper assembly with forty project cards', async function () {
		await switchPage('06-home-to-writing', '首页 → 论文装配（40 个项目卡片）', 'agent', 'writing');
	});
	it('07 opens the large project from its card into assembly', async function () {
		let ui = await ensureWorkspace('writing');
		if (assemblyFrame()) {
			win.Zotero_Tabs.close(assemblyFrame().parentElement.id);
			await settle(300);
			await ensureWorkspace('writing');
		}
		await measure('07-open-big-project', '打开大项目进入装配（继续装配）', LIMITS.openProject, async ({ ready, extras }) => {
			let open = ui.$('manuscript-projects').querySelector('.project-card[data-project-id="' + BIG_ID + '"] .project-open');
			assert.exists(open, '大项目卡片的“继续装配”');
			open.click();
			await waitFor(() => assemblyUI()?.ready && win.Zotero_Tabs.selectedType === 'manuscript', '大项目装配页', { timeout: LIMITS.openProject + 5000 });
			ready();
			let doc = assemblyFrame().contentDocument;
			extras.renderedBlocks = doc.querySelectorAll('#canvas .block').length;
			extras.pages = doc.querySelectorAll('#canvas .paper').length;
			extras.materialCards = doc.querySelectorAll('#material-results article.material[data-material]').length;
			extras.saveStatus = doc.getElementById('save-status')?.textContent;
		});
	});
	// The four assembly stages; readiness follows researchAssemblyWorkflowTest.
	let stageReady = (U, target) => {
		let doc = assemblyFrame().contentDocument, control = doc.querySelector('#steps [data-step="' + target + '"]');
		if (U.p.ui.step !== target || doc.body.dataset.assemblyStage !== String(target) || control?.getAttribute('aria-current') !== 'step') return false;
		if (target === 3) return Array.isArray(U.workflow.issues) && !doc.getElementById('workflow-panel').hidden && !doc.querySelector('.workflow-check-summary')?.textContent.includes('正在检查');
		if (target === 0) return U.p.ui.left === 'materials' && !!doc.getElementById('material-search');
		return true;
	};
	let switchStage = async (id, label, from, target) => {
		let U = await ensureAssembly(from);
		return measureStage(id, label, U, target);
	};
	let measureStage = (id, label, U, target) => measure(id, label, LIMITS.stage, async ({ ready, extras }) => {
		let doc = assemblyFrame().contentDocument;
		let control = doc.querySelector('#steps [data-step="' + target + '"]');
		assert.exists(control, '装配阶段按钮 ' + target);
		extras.stageLabel = control.textContent;
		control.click();
		if (U.p.ui.step !== target) throw new Error(label + '被阻止：' + (doc.getElementById('assembly-step-blocked')?.textContent || '阶段没有切换'));
		await waitFor(() => stageReady(U, target), label, { timeout: LIMITS.stage + 5000 });
		ready();
		extras.directionWorkspace = !!doc.getElementById('direction-workspace') && !doc.getElementById('direction-workspace').hidden;
		extras.writingAssistant = doc.body.dataset.writingAssistant || null;
		extras.issues = Array.isArray(U.workflow.issues) ? U.workflow.issues.length : null;
		extras.renderedBlocks = doc.querySelectorAll('#canvas .block').length;
	});
	it('08 switches assembly from 素材装配 to 方向讨论', async function () {
		await switchStage('08-stage-0-to-1', '装配阶段：素材装配 → 方向讨论', 0, 1);
	});
	it('09 switches assembly from 方向讨论 to 速读细调', async function () {
		await switchStage('09-stage-1-to-2', '装配阶段：方向讨论 → 速读细调', 1, 2);
	});
	it('10 switches assembly from 速读细调 to 内容导出 and runs the whole-manuscript check', async function () {
		await switchStage('10-stage-2-to-3', '装配阶段：速读细调 → 内容导出（全文检查）', 2, 3);
	});
	it('11 switches assembly from 内容导出 back to 素材装配', async function () {
		await switchStage('11-stage-3-to-0', '装配阶段：内容导出 → 素材装配', 3, 0);
	});
	it('12 types continuously into an assembly body block with a 500 ms pause and waits for the debounced save', async function () {
		const PART1 = '补充实验：在零分贝附近记录了' + PHASE_QUERY + '前后的识别准确率，';
		const PART2 = '跨设备批次的差异需要再做三次独立重复。';
		let U = await ensureAssembly(0), frame = assemblyFrame(), doc = frame.contentDocument;
		let editable = () => doc.querySelector('[data-id="' + TYPE_BLOCK_ID + '"] .editable');
		if (!editable()) {
			U.selectBlock(TYPE_BLOCK_ID, { scroll: true });
			await waitFor(editable, '输入目标正文块');
		}
		let block = U.p.blocks.find(row => row.id === TYPE_BLOCK_ID);
		await measure('12-assembly-typing', '装配正文块连续输入（含 500 ms 停顿，覆盖防抖保存）', LIMITS.typing, async ({ ready, extras }) => {
			win.focus();
			frame.contentWindow.focus();
			editable().focus();
			extras.frameHasFocus = doc.hasFocus();
			extras.contentEditable = editable().contentEditable;
			let keyMs = [], lateMs = [], methods = { execCommand: 0, fallback: 0 }, start = now(), at = 0;
			let typeAll = async (value) => {
				for (let char of value) {
					at += 70;
					let wait = start + at - now();
					if (wait > 0) await sleep(wait);
					lateMs.push(Math.max(0, now() - start - at));
					let keyStart = now();
					methods[typeIntoEditable(editable(), char)]++;
					keyMs.push(now() - keyStart);
				}
			};
			await typeAll(PART1);
			await sleep(500);
			at = now() - start;
			await typeAll(PART2);
			await waitFor(() => block.text.includes(PART1 + PART2) && doc.getElementById('save-status')?.textContent === SAVED_LABEL && counters.saveDone >= counters.saveStarted, '输入保存完成', { timeout: LIMITS.typing });
			ready();
			Object.assign(extras, { characters: (PART1 + PART2).length, pauseMs: 500, debounceMs: 350, methods, maxKeyMs: Math.round(Math.max(...keyMs)), p95KeyMs: Math.round(percentile(keyMs, 0.95)), maxLateMs: Math.round(Math.max(...lateMs)), p95LateMs: Math.round(percentile(lateMs, 0.95)) });
		}, {
			verify: async () => {
				let start = now(), saved = E.store.peek('manuscripts', BIG_ID)?.blocks.find(row => row.id === TYPE_BLOCK_ID);
				return { persisted: !!saved?.text.includes(PART1 + PART2), peekMs: Math.round(now() - start) };
			}
		});
	});
	// Material library in the assembly left pane (researchManualAuthoringTest / researchPreparationFlowTest).
	let materialDoc = () => assemblyFrame().contentDocument;
	let shownCards = () => [...materialDoc().querySelectorAll('#material-results article.material[data-material]')];
	let setMaterialQuery = async (value) => {
		let U = await ensureAssembly(0), input = materialDoc().getElementById('material-search');
		if (U.materialQuery !== value || input.value !== value) {
			input.value = value;
			input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
			await waitFor(() => U.materialQuery === value && shownCards().length > 0, '素材检索词 ' + (value || '（空）'));
		}
		await settle(TAIL_MS);
		return U;
	};
	it('13 searches the material library while typing a Chinese query', async function () {
		let U = await setMaterialQuery('');
		await measure('13-material-search', '素材库搜索（逐字输入“' + PHASE_QUERY + '”）', LIMITS.material, async ({ ready, extras }) => {
			let input = materialDoc().getElementById('material-search'), view = input.ownerDocument.defaultView, delays = [0, 230, 90, 210, 120, 260];
			input.focus();
			for (let [i, char] of [...PHASE_QUERY].entries()) {
				await sleep(delays[i]);
				input.value += char;
				input.dispatchEvent(new view.Event('input', { bubbles: true }));
			}
			await waitFor(() => U.materialQuery === PHASE_QUERY && shownCards().some(node => phaseIDs.has(node.dataset.material)), '素材搜索结果', { timeout: LIMITS.material });
			ready();
			let cards = shownCards();
			Object.assign(extras, { shownCards: cards.length, shownPhaseCards: cards.filter(node => phaseIDs.has(node.dataset.material)).length, seededMatches: phaseIDs.size, hasMore: !!materialDoc().querySelector('#material-results .list-end-sentinel') });
		});
	});
	it('14 clears the material search and shows the whole library again', async function () {
		let U = await setMaterialQuery(PHASE_QUERY);
		await measure('14-material-clear', '素材库清空搜索', LIMITS.material, async ({ ready, extras }) => {
			let usable = node => node?.isConnected && !node.disabled && !node.hidden && node.getClientRects().length > 0;
			let control = [materialDoc().querySelector('.material-filter-reset'), materialDoc().querySelector('#material-results .active-filters button')].find(usable);
			assert.exists(control, '素材库的“清空”按钮');
			extras.control = control.className || control.textContent;
			control.click();
			await waitFor(() => U.materialQuery === '' && materialDoc().getElementById('material-search').value === '' && shownCards().length > 0, '清空素材搜索', { timeout: LIMITS.material });
			ready();
			extras.shownCards = shownCards().length;
			extras.activeFilterBar = !!materialDoc().querySelector('#material-results .active-filters');
		});
	});
	it('15 opens a material detail in the right pane', async function () {
		let U = await setMaterialQuery('');
		await measure('15-material-detail', '打开一份素材的详情', LIMITS.material, async ({ ready, extras }) => {
			let cards = shownCards(), target = cards[Math.min(2, cards.length - 1)];
			assert.exists(target, '素材卡片');
			let id = target.dataset.material;
			target.click();
			let doc = materialDoc();
			await waitFor(() => U.previewMaterialID === id && doc.getElementById('details').dataset.materialId === id && !doc.getElementById('right').hidden, '素材详情', { timeout: LIMITS.material });
			ready();
			extras.materialID = id;
			extras.detailChars = doc.getElementById('details').textContent.length;
		});
	});
	it('16 collapses the right pane', async function () {
		let U = await ensureAssembly(0), doc = materialDoc();
		if (doc.getElementById('right').hidden) {
			doc.getElementById('toggle-right').click();
			await waitFor(() => !doc.getElementById('right').hidden, '展开右栏');
			await settle(TAIL_MS);
		}
		await measure('16-collapse-right', '收起右栏', LIMITS.material, async ({ ready, extras }) => {
			doc.getElementById('toggle-right').click();
			await waitFor(() => doc.getElementById('right').hidden && U.p.ui.rightOpen === false, '收起右栏', { timeout: LIMITS.material });
			ready();
			extras.canvasWidth = Math.round(doc.getElementById('canvas').getBoundingClientRect().width);
		});
	});
	it('17 scrolls the material list to its end', async function () {
		await setMaterialQuery('');
		let host = materialDoc().getElementById('library');
		host.scrollTop = 0;
		await settle(300);
		await measure('17-material-scroll', '滚动素材列表（到底并等待下一批）', LIMITS.material, async ({ ready, extras }) => {
			let before = shownCards().length, view = host.ownerDocument.defaultView;
			for (let i = 0; i < 8; i++) {
				host.scrollTop += Math.max(200, host.clientHeight * 0.8);
				host.dispatchEvent(new view.Event('scroll'));
				await nextFrame();
			}
			host.scrollTop = host.scrollHeight;
			host.dispatchEvent(new view.Event('scroll'));
			let appended = await waitFor(() => shownCards().length > before, '加载下一批素材', { timeout: 2500, soft: true });
			ready();
			Object.assign(extras, { before, after: shownCards().length, appended, scrollHeight: host.scrollHeight, clientHeight: host.clientHeight });
		});
	});
	it('18 opens the feasibility page (notebook) of the large project', async function () {
		await E.notebook.update(BIG_ID, { view: 'plan' });
		if (notebookFrame()) {
			win.Zotero_Tabs.close(notebookFrame().parentElement.id);
			await settle(300);
		}
		await measure('18-open-feasibility', '打开大项目的可行性页（笔记本）', LIMITS.notebookOpen, async ({ ready, extras }) => {
			await E.notebook.open(BIG_ID, { win });
			await waitFor(notebookReady, '可行性方案页', { timeout: LIMITS.notebookOpen + 5000 });
			ready();
			let doc = notebookFrame().contentDocument;
			extras.sourceRows = doc.querySelectorAll('#source-list [data-material]').length;
			extras.ideaChars = doc.getElementById('idea').value.length;
		});
	});
	it('19 types the research question on the feasibility page and pauses until the draft is saved', async function () {
		let frame = await ensureNotebook(), field = frame.contentDocument.getElementById('idea');
		let PART1 = '补充：' + PHASE_QUERY + '是否在跨设备批次上同样有效，', PART2 = '还需要比较两台接收机的频偏差异（第 ' + Date.now() + ' 轮）。';
		await measure('19-feasibility-typing', '可行性页研究问题输入并停顿保存', LIMITS.notebookTyping, async ({ ready, extras }) => {
			field.focus();
			let keyMs = [];
			for (let [index, part] of [PART1, PART2].entries()) {
				for (let char of part) {
					await sleep(70);
					let start = now();
					typeIntoField(field, char);
					keyMs.push(now() - start);
				}
				if (!index) await sleep(700);
			}
			let expected = field.value;
			await waitFor(() => E.notebook.state(BIG_ID).ideaDraft === expected, '研究问题草稿保存', { timeout: LIMITS.notebookTyping });
			ready();
			Object.assign(extras, { characters: (PART1 + PART2).length, pauseMs: 700, debounceMs: 500, maxKeyMs: Math.round(Math.max(...keyMs)), p95KeyMs: Math.round(percentile(keyMs, 0.95)) });
		}, {
			verify: async () => ({ researchGoalSynced: (E.store.peek('manuscripts', BIG_ID)?.researchGoal || '').includes(PART2.slice(0, 12)) })
		});
	});
	it('20 repeats the small note-link write with every research page open', async function () {
		await measure('20-storage-write-all-open', '基线复测：所有研究页面打开时保存笔记链接', LIMITS.storage, async ({ ready, extras }) => {
			extras.open = { workspace: !!workspace()?.ui?.ready, assembly: !!assemblyUI()?.ready, notebook: !!notebookFrame()?.contentWindow?.NotebookUI?.ready };
			await noteLinkWrites('all-open', extras);
			ready();
		});
	});
});
