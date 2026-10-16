/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Chapter-scoped paper writing plan acceptance', function () {
 this.timeout(150000);
 const E = Zotero.Research;
 const Writing = ChromeUtils.importESModule('chrome://zotero/content/research/shared/assembly-writing-preview.mjs');
 const Assessment = ChromeUtils.importESModule('chrome://zotero/content/research/shared/manuscript-assessment.mjs');
 let win, frame, U, projectID, baseline, folder, prior, calls = [];
 const report = {type: '真实 Gecko 界面及本机持久化；模型回复受控，不证明真实模型内容质量', checks: []};
 const doc = () => frame.contentDocument;
 const fw = () => frame.contentWindow;
 const root = () => doc().getElementById('paper-writing-workflow');
 const chapterID = index => U.p.sections[index].id;
 const materialID = index => 'workflow-source-' + index;
 const records = () => JSON.stringify({blocks: U.p.blocks, materials: U.p.materials});
 const wait = async (fn, label = '写作计划') => {
  for (let i = 0; i < 400; i++) {
   if (await fn()) return;
   await Zotero.Promise.delay(30);
  }
  throw Error('等待' + label + '超时；' + U?.$('status')?.textContent);
 };
 const deadline = (promise, label) => new Promise((resolve, reject) => {
  const timer = win.setTimeout(() => reject(Error(label + '超过 10 秒')), 10000);
  Promise.resolve(promise).then(value => {
   win.clearTimeout(timer);
   resolve(value);
  }, error => {
   win.clearTimeout(timer);
   reject(error);
  });
 });
 const screenshot = async name => {
  if (win.windowState === win.STATE_MINIMIZED) win.restore();
  if (!win.document.hasFocus()) win.focus();
  await deadline(new Promise(resolve => fw().requestAnimationFrame(() => fw().requestAnimationFrame(resolve))), '等待截图绘制');
  const image = await deadline(win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white'), '原生窗口截图');
  try {
   const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
   canvas.width = image.width;
   canvas.height = image.height;
   canvas.getContext('2d').drawImage(image, 0, 0);
   const blob = await deadline(new Promise(resolve => canvas.toBlob(resolve, 'image/png')), '编码截图');
   if (!blob) throw Error('截图编码失败');
   await IOUtils.write(PathUtils.join(folder, name + '.png'), new Uint8Array(await blob.arrayBuffer()));
  }
  finally {image.close();}
 };
 const openPlan = async () => {
  U.$('left-tabs').querySelector('[data-view=structure]').click();
  const action = U.$('library').querySelector('[data-action=open-writing-plan]');
  assert.exists(action, '写作计划从论文结构内进入');
  action.click();
  await wait(() => root()?.open, '同页展开写作计划');
  assert.equal(U.p.ui.canvasDisplay, 'digest');
  assert.isFalse(U.$('popover').open, '不另开模态弹窗');
  assert.equal(root().closest('#canvas'), U.$('canvas'));
 };
 const setField = (key, value) => {
  const input = root().querySelector('[data-workflow-field="' + key + '"]');
  assert.exists(input, '可编辑计划字段 ' + key);
  for (let parent = input.parentElement; parent && parent !== root(); parent = parent.parentElement) {
   if (parent.localName === 'details') parent.open = true;
  }
  input.value = value;
  input.dispatchEvent(new (fw().Event)('input', {bubbles: true}));
 };
 const selectChapter = index => {
  const before = records();
  const choice = root().querySelector('[data-workflow-section]');
  choice.value = chapterID(index);
  choice.dispatchEvent(new (fw().Event)('change', {bubbles: true}));
  assert.equal(U.p.ui.sectionID, chapterID(index));
  assert.equal(U.p.blocks.find(block => block.id === U.p.ui.blockID)?.sectionID, chapterID(index), '计划、当前正文与右侧详情属于同一章');
  assert.equal(records(), before, '切换计划章节不改正文或素材');
 };
 const selectRole = (role, index) => {
  const input = root().querySelector('[data-workflow-role="' + role + '"][data-workflow-material="' + materialID(index) + '"]');
  assert.exists(input, '当前章可选择完整素材 ' + materialID(index));
  input.closest('details').open = true;
  if (!input.checked) input.click();
  assert.isTrue(input.checked);
 };
 const generate = async index => {
  selectChapter(index);
  const before = calls.length;
  root().querySelector('[data-action=workflow-generate-section]').click();
  await wait(() => calls.length > before && U.p.writingFrameworks?.[chapterID(index)] && !U.frameworkBusy && !U.busy, '按本章计划生成写作速读');
  assert.isFalse(U.p.writingFrameworks[chapterID(index)].dirty);
 };
 const fixtureValue = input => ({nodes: input.authorNotes.map(row => ({
  purpose: input.targetSection === '方法' ? '说明操作次序与指标定义' : '界定本章问题与论证顺序',
  claim: '本章按已选素材说明已知条件，并保留需要补充的验证。',
  status: 'supported',
  authorBlockIDs: [row.id],
  materialIDs: row.materials.map(link => link.id),
  quoteIDs: input.evidenceExcerpts.filter(excerpt => row.materials.some(link => link.id === excerpt.sourceID) || excerpt.sourceID === 'author:' + row.id).map(excerpt => excerpt.quoteID),
  written: '现有正文记录了当前研究的范围与条件。',
  planned: '按本章计划补充来源对应关系，并保留尚未完成的工作。',
  adjustment: '先说明对象及条件，再安排操作和证据；统一术语，不改变人工正文。',
  narrative: '本章已有正文明确了研究对象和当前条件。接下来依照用户指定的段落顺序组织完整素材，说明每份来源用于背景、方法还是结果比较；方法保留操作次序与指标定义，结果只采用实际观察。未实施的验证继续作为计划记录，不把前人的结论写成本研究发现。人工段落保留原有内容，调整建议仅保存在这份写作速读中。',
  questions: ['仍需核对当前条件下的对照依据。'],
  template: input.rule.templates[0]
 }))});

 before(async () => {
  prior = {request: E.studio.request, settings: E.settings, sync: E.manuscripts.syncLibrary};
  E.manuscripts.syncLibrary = async () => {};
  try {
   win = await loadZoteroPane();
   await E.attachWindow(win);
   if (win.windowState === win.STATE_MINIMIZED) win.restore();
   if (!win.document.hasFocus()) win.focus();
   win.resizeTo(1600, 1000);
   const project = await E.manuscripts.create('按章写作计划原生验收 ' + Date.now());
   projectID = project.id;
   await E.manuscripts.open(projectID);
   await wait(() => {
    frame = win.document.getElementById('manuscript-' + projectID);
    U = frame?.contentWindow.ManuscriptUI;
    return U?.ready;
   }, '真实装配项目');
  }
  finally {E.manuscripts.syncLibrary = prior.sync;}
  folder = PathUtils.join(Zotero.DataDirectory.dir, 'paper-writing-workflow-acceptance');
  await IOUtils.makeDirectory(folder, {ignoreExisting: true});
  U.p.sections = U.p.sections.slice(0, 4);
  ['引言', '方法', '结果', '讨论'].forEach((title, index) => U.p.sections[index].title = title);
  const sources = [
   ['研究背景的完整段落', 'Existing studies describe signal recognition under specific acquisition conditions. Noise and channel changes require separate validation.'],
   ['方法操作与指标定义的完整段落', 'The samples are divided by independent acquisition batches. The threshold is selected on validation data. Accuracy is the number of correct predictions divided by all test samples.'],
   ['实际结果记录的完整段落', 'The controlled test contains 100 samples. The baseline correctly identifies 80 samples and the comparison method identifies 84 samples under the same split.'],
   ['前人结果及适用条件的完整段落', 'The previous experiment uses a fixed channel and reports classification accuracy. Its observations do not establish performance under a changed channel.'],
   ['未关联到任何章节的完整素材', 'UNUSED_SOURCE_MUST_NOT_ENTER_CHAPTER_REQUEST. This paragraph belongs to a different research topic.']
  ];
  U.p.materials = sources.map(([title, sourceText], index) => U.M.material({id: materialID(index), kind: 'semantic', title, sourceText, summary: title, sectionType: ['引言', '方法', '结果', '讨论', '方法'][index]}));
  U.p.blocks = U.p.sections.map((section, index) => U.M.block('paragraph', section.id, {text: ['引言原稿：识别任务需要明确采集条件与研究缺口。', '方法原稿：按独立采集批次划分数据。', '结果原稿：仅记录已经核对的观测，不扩展结论。', '讨论原稿：对齐本研究与前人研究的具体条件。'][index], materials: [{id: materialID(index), role: 'primary'}]}));
  U.p.blocks.push(U.M.block('formula', chapterID(2), {text: 'A=\\frac{n_{correct}}{n_{test}}', title: '准确率定义'}));
  U.p.ui.sectionID = chapterID(0);
  U.p.ui.blockID = U.p.blocks[0].id;
  U.p.ui.left = 'structure';
  U.p.ui.canvasDisplay = 'materials';
  U.changed({editor: true});
  await U.persist({flush: true});
  baseline = U.M.clone(U.p);
 });
 beforeEach(async () => {
  calls = [];
  U.p = U.M.clone(baseline);
  U.previewMaterialID = null;
  U.busy = false;
  U.frameworkBusy = false;
  await E.notebook.update(projectID, {selectedMaterial: null, query: ''});
  U.changed({editor: true});
  await U.persist({flush: true});
  E.settings = () => ({...prior.settings(), endpoint: 'https://fixture.invalid/v1', model: 'paper-workflow-fixture'});
  E.studio.request = async (system, input, progress, signal, options) => {
   calls.push({input: U.M.clone(input), options: U.M.clone(options)});
   assert.equal(options.aiAction, 'evidence_organize');
   return {model: 'paper-workflow-fixture', value: fixtureValue(input)};
  };
  await U.conversations.update(U.conversationSession.id, {modelID: 'paper-workflow-fixture', thinkingLevel: 'high', executionMode: 'auto'}, {origin: 'assembly'});
  await openPlan();
 });
 afterEach(async function () {
  E.studio.request = prior.request;
  E.settings = prior.settings;
  report.checks.push({name: this.currentTest.title, state: this.currentTest.state, error: this.currentTest.err?.message});
  if (this.currentTest.state === 'failed') await screenshot('failure-' + report.checks.length);
  await IOUtils.writeUTF8(PathUtils.join(folder, 'report.json'), JSON.stringify(report, null, 2));
 });
 after(async () => {
  E.studio.request = prior.request;
  E.settings = prior.settings;
  E.manuscripts.syncLibrary = prior.sync;
  if (projectID) {
   await U?.persist({flush: true});
   win.Zotero_Tabs.close('manuscript-' + projectID);
   await E.manuscripts.remove(projectID);
  }
  await E.store.flush();
  win?.close();
 });

 it('edits a continuous plan inline, persists it across closing and reopening, and fits wide and narrow windows', async () => {
  const question = '在独立采集批次和信道变化条件下，怎样比较识别方法的泛化能力？\n\n先限定数据来源和验证范围，再讨论可实施的最小实验。';
  setField('question', question);
  setField('hypotheses', '若方法只利用当前信道特征，跨信道准确率会下降；同批次泄漏可能造成过高估计。');
  setField('resourceNotes', '已有连续实验记录和采集批次清单。待补跨信道测试，不把计划写成实验结果。');
  setField('terminology', '准确率统一记为 $A$，单位为百分比；数据划分以独立采集批次为单位。');
  setField('reviewerNotes', '引言交代适用条件，方法给出数据隔离步骤；尚未完成的验证保持明确。');
  selectChapter(1);
  setField('purpose', '交代数据从采集、划分到评价的操作次序和参数依据。');
  setField('structure', '先定义样本与批次，再说明划分、阈值选择和指标。\n\n每一步保留输入输出和方法来源。');
  setField('methods', '按批次划分训练、验证和测试；仅用验证集确定阈值。\n\n准确率 $A=n_{correct}/n_{test}$，测试集不参与参数选择。');
  setField('revisionNotes', '核对全部指标的符号和单位，保留实际操作条件。');
  selectRole('referenceMaterialIDs', 1);
  selectRole('methodSourceMaterialIDs', 1);
  await U.persist({flush: true});
  const saved = U.A.get(projectID).writingWorkflow;
  assert.equal(saved.question, question);
  assert.equal(saved.sections[chapterID(1)].methods, root().querySelector('[data-workflow-field=methods]').value);
  assert.lengthOf(calls, 0, '编辑计划不自动请求模型');
  assert.equal(records(), JSON.stringify({blocks: baseline.blocks, materials: baseline.materials}), '写作计划不改正文和完整素材');
  root().querySelector('.paper-workflow-global').open = false;
  await screenshot('writing-plan-wide');
  try {
   win.resizeTo(1100, 1000);
   await Zotero.Promise.delay(300);
   assert.isAtMost(root().scrollWidth, root().clientWidth + 1, '窄窗计划不产生横向溢出');
   const bounds = root().getBoundingClientRect();
   for (const input of root().querySelectorAll('.paper-workflow-chapter textarea')) {
    const rect = input.getBoundingClientRect();
    assert.isAtLeast(rect.left, bounds.left);
    assert.isAtMost(rect.right, bounds.right + 1);
   }
   await screenshot('writing-plan-narrow');
  }
  finally {win.resizeTo(1600, 1000);}
  await U.persist({flush: true});
  await E.store.flush();
  win.Zotero_Tabs.close('manuscript-' + projectID);
  await E.manuscripts.open(projectID);
  await wait(() => {
   frame = win.document.getElementById('manuscript-' + projectID);
   U = frame?.contentWindow.ManuscriptUI;
   return U?.ready;
  }, '重开已保存的计划');
  assert.isTrue(root().open);
  assert.deepEqual(U.p.writingWorkflow, saved);
  assert.equal(root().querySelector('[data-workflow-field=question]').value, question);
  assert.isTrue(root().querySelector('[data-workflow-role=methodSourceMaterialIDs]').checked);
 });

 it('keeps chapter plans, structural references and result figures inside their own chapter', async () => {
  setField('purpose', 'INTRO_PRIVATE_PLAN：先建立研究场景，再界定问题。');
  setField('structure', 'INTRO_STRUCTURE：场景、缺口、研究目标。');
  selectRole('referenceMaterialIDs', 0);
  assert.deepEqual([...root().querySelectorAll('[data-workflow-role=referenceMaterialIDs]')].map(input => input.dataset.workflowMaterial), [materialID(0)]);
  selectChapter(1);
  assert.equal(root().querySelector('[data-workflow-field=purpose]').value, '');
  setField('purpose', 'METHOD_PRIVATE_PLAN：按实际操作次序说明方法。');
  setField('methods', 'METHOD_PRIVATE_OPERATIONS：保持批次隔离，再选择阈值。');
  selectRole('referenceMaterialIDs', 1);
  selectRole('methodSourceMaterialIDs', 1);
  assert.deepEqual([...root().querySelectorAll('[data-workflow-role=referenceMaterialIDs]')].map(input => input.dataset.workflowMaterial), [materialID(1)]);
  assert.notExists(root().querySelector('[data-workflow-material="' + materialID(4) + '"]'), '未使用素材不混入章节选择');
  selectChapter(2);
  setField('findings', 'RESULT_PRIVATE_PLAN：同一划分下记录基线与比较方法的观测。');
  selectRole('findingSourceMaterialIDs', 2);
  const figure = root().querySelector('[data-workflow-figure]');
  assert.exists(figure);
  figure.click();
  selectChapter(3);
  setField('comparisons', 'DISCUSSION_PRIVATE_PLAN：对齐固定信道与变化信道的条件，不把相关性解释为因果。');
  selectRole('comparisonSourceMaterialIDs', 3);
  assert.notExists(root().querySelector('[data-workflow-figure]'), '其他章的公式不成为讨论章图表');
  selectChapter(0);
  assert.equal(root().querySelector('[data-workflow-field=purpose]').value, 'INTRO_PRIVATE_PLAN：先建立研究场景，再界定问题。');
  assert.isTrue(root().querySelector('[data-workflow-role=referenceMaterialIDs]').checked);
  assert.notExists(root().querySelector('[data-workflow-field=methods]'));
  await U.persist({flush: true});
  const saved = U.A.get(projectID).writingWorkflow.sections;
  assert.deepEqual(saved[chapterID(0)].referenceMaterialIDs, [materialID(0)]);
  assert.deepEqual(saved[chapterID(1)].referenceMaterialIDs, [materialID(1)]);
  assert.deepEqual(saved[chapterID(2)].figureBlockIDs, [U.p.blocks[4].id]);
  assert.deepEqual(saved[chapterID(3)].comparisonSourceMaterialIDs, [materialID(3)]);
  assert.lengthOf(calls, 0);
 });

 it('passes the selected chapter plan and structural reference to the controlled model without other chapter data', async () => {
  setField('question', '判断批次隔离后跨信道识别的适用条件。');
  setField('terminology', '统一称为独立采集批次。');
  setField('purpose', 'INTRO_PRIVATE_PLAN：从采集场景推进到未检验的问题。');
  setField('structure', '先说明对象，再比较已知条件，最后提出待验证缺口。');
  selectRole('referenceMaterialIDs', 0);
  selectChapter(1);
  setField('purpose', 'METHOD_SECRET_MUST_NOT_LEAK：单独描述操作步骤。');
  setField('methods', 'METHOD_SECRET_MUST_NOT_LEAK：按批次划分并在验证集选阈值。');
  selectRole('referenceMaterialIDs', 1);
  const before = records();
  await generate(0);
  const input = calls[0].input, plan = input.writingWorkflow;
  assert.equal(plan.section.id, chapterID(0));
  assert.equal(plan.section.purpose, 'INTRO_PRIVATE_PLAN：从采集场景推进到未检验的问题。');
  assert.deepEqual(plan.section.referenceMaterialIDs, [materialID(0)]);
  assert.equal(plan.terminology, '统一称为独立采集批次。');
  assert.isUndefined(plan.sections, '局部请求没有其他章节计划');
  assert.deepEqual(input.sources.map(source => source.id), [materialID(0)]);
  assert.notInclude(JSON.stringify(input), 'METHOD_SECRET_MUST_NOT_LEAK');
  assert.notInclude(JSON.stringify(input), 'UNUSED_SOURCE_MUST_NOT_ENTER_CHAPTER_REQUEST');
  assert.include(plan.requirements.structure, '段落功能');
  assert.equal(records(), before);
  assert.equal(U.A.get(projectID).writingFrameworks[chapterID(0)].nodes[0].narrative, U.p.writingFrameworks[chapterID(0)].nodes[0].narrative);
 });

 it('marks generated chapter digests stale after global terminology changes without changing prose or requesting a model', async () => {
  setField('question', '比较独立采集条件下的识别方法。');
  await generate(0);
  await generate(1);
  const before = records(), narratives = U.p.sections.slice(0, 2).map(section => U.p.writingFrameworks[section.id].nodes[0].narrative), count = calls.length;
  setField('terminology', '术语更新：采集批次统一称为独立采集批次；准确率统一记为 $A$。');
  await U.persist({flush: true});
  for (const section of U.p.sections.slice(0, 2)) {
   assert.isTrue(U.p.writingFrameworks[section.id].dirty, '共同术语变化使已有章节需要刷新');
   assert.isTrue(U.p.writingFrameworks[section.id].nodes[0].dirty);
  }
  assert.deepEqual(U.p.sections.slice(0, 2).map(section => U.p.writingFrameworks[section.id].nodes[0].narrative), narratives, '保留旧速读供阅读');
  assert.equal(records(), before);
  assert.lengthOf(calls, count);
  assert.isTrue(U.A.get(projectID).writingFrameworks[chapterID(0)].dirty);
 });

 it('invalidates only the edited chapter for a local revision plan and preserves every authored paragraph', async () => {
  setField('question', '按独立采集批次验证识别方法的适用条件。');
  await generate(0);
  await generate(1);
  const before = records(), count = calls.length, kept = U.M.clone(U.p.writingFrameworks[chapterID(0)]);
  setField('revisionNotes', '仅方法章：补足采集批次隔离的操作说明，并核对阈值选择的数据来源。');
  await U.persist({flush: true});
  assert.isTrue(U.p.writingFrameworks[chapterID(1)].dirty);
  assert.isTrue(U.p.writingFrameworks[chapterID(1)].nodes[0].dirty);
  assert.isFalse(U.p.writingFrameworks[chapterID(0)].dirty, '本章调整不使无关章节重新生成');
  assert.deepEqual(U.p.writingFrameworks[chapterID(0)], kept);
  assert.equal(records(), before);
  assert.lengthOf(calls, count);
  assert.isFalse(root().querySelector('[data-action=check-writing-plan]').disabled);
  root().querySelector('[data-action=check-writing-plan]').click();
  assert.equal(records(), before);
  assert.lengthOf(calls, count, '本地缺口检查不调用模型');
 });

 it('passes the current chapter plan into real previewWriting and invalidates candidates and full assessment signatures after a plan edit', async () => {
  setField('question', '比较独立采集批次下的识别方法，保留具体条件。');
  setField('terminology', '准确率统一称为分类准确率。');
  setField('purpose', 'INTRO_PLAN_NOT_FOR_LOCAL_REWRITE：说明研究缺口。');
  selectRole('referenceMaterialIDs', 0);
  selectChapter(1);
  setField('purpose', '方法按实际操作顺序说明批次划分和阈值选择。');
  setField('methods', '先按独立采集批次划分数据，再使用验证集选择阈值。');
  selectRole('referenceMaterialIDs', 1);
  selectRole('methodSourceMaterialIDs', 1);
  await U.persist({flush: true});
  const before = records();
  E.studio.request = async (system, input, progress, signal, options) => {
   assert.equal(options.aiAction, 'manuscript_preview');
   calls.push({input: U.M.clone(input), options: U.M.clone(options)});
   const quoteIDs = input.evidenceExcerpts.map(excerpt => excerpt.quoteID);
   return {model: 'paper-workflow-fixture', value: {variants: [
    {label: '操作顺序', text: input.before + ' 先交代采集批次的独立性，再说明验证集用于选择阈值。', quoteIDs},
    {label: '隔离条件', text: input.before + ' 将数据划分与阈值选择分开说明，保持测试批次独立。', quoteIDs}
   ]}};
  };
  const generateButton = U.$('details').querySelector('[data-action=generate-writing-preview]');
  assert.exists(generateButton, '选定方法计划后右侧显示本章正文改写');
  assert.isFalse(generateButton.disabled);
  generateButton.click();
  await wait(() => calls.length === 1 && U.p.proposals.some(row => row.kind === 'assembly-writing-preview') && !U.writingPreviewBusy, '实际局部候选服务');
  const preview = U.p.proposals.findLast(row => row.kind === 'assembly-writing-preview');
  const input = calls[0].input;
  assert.equal(input.sectionID, chapterID(1));
  assert.equal(input.writingWorkflow.section.id, chapterID(1));
  assert.equal(input.writingWorkflow.section.methods, '先按独立采集批次划分数据，再使用验证集选择阈值。');
  assert.deepEqual(input.writingWorkflow.section.referenceMaterialIDs, [materialID(1)]);
  assert.deepEqual(input.writingWorkflow.section.methodSourceMaterialIDs, [materialID(1)]);
  assert.notInclude(JSON.stringify(input), 'INTRO_PLAN_NOT_FOR_LOCAL_REWRITE');
  assert.deepEqual(input.writingWorkflow, preview.capture.writingWorkflow);
  assert.isFalse(U.$('details').querySelector('[data-action=accept-writing-candidate]').disabled);
  assert.equal(records(), before, '准备候选不替换人工正文');

  const assessmentInput = Assessment.assessmentInput(U.p);
  assert.equal(assessmentInput.writingWorkflow.question, U.p.writingWorkflow.question);
  assert.equal(assessmentInput.writingWorkflow.sections[chapterID(0)].purpose, 'INTRO_PLAN_NOT_FOR_LOCAL_REWRITE：说明研究缺口。');
  assert.equal(assessmentInput.writingWorkflow.sections[chapterID(1)].methods, U.p.writingWorkflow.sections[chapterID(1)].methods);
  assert.lengthOf(Object.keys(assessmentInput.writingWorkflow.sections), U.p.sections.length, '全文评估包含所有章节计划');
  assert.isUndefined(assessmentInput.manuscript.writingWorkflow, '计划只携带一份，不重复嵌入正文');
  const assessment = {status: 'ready', version: Assessment.ASSESSMENT_VERSION, signature: Assessment.assessmentSignature(U.p)};
  assert.isTrue(Assessment.isCurrentAssessment(U.p, assessment));

  setField('terminology', '术语已修订：统一为分类准确率，明确按独立测试批次计算。');
  U.changed();
  await U.persist({flush: true});
  assert.isTrue(U.$('details').querySelector('[data-action=accept-writing-candidate]').disabled, '计划改变后旧候选不能采用');
  assert.throws(() => Writing.applyWritingPreview(U.p, preview, preview.variants[0].id, {confirmed: true}), /已变化|重新生成/);
  assert.equal(preview.status, 'pending');
  assert.isFalse(Assessment.isCurrentAssessment(U.p, assessment));
  assert.notEqual(Assessment.assessmentSignature(U.p), assessment.signature);
  assert.equal(records(), before, '拒绝旧候选并保留全部正文和素材');
  assert.lengthOf(calls, 1, '计划失效和全文评估输入检查均无需额外模型请求');
 });
});
