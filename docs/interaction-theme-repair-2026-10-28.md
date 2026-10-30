# 选区标注、检索恢复、导出与暗色同步修复

日期：2026-10-28。对应本轮三个测试截图中的选区浮层无法直接标注、反复筛选后检索无法恢复、正文导出受阻，以及暗色界面遗留浅色窗口。

本轮沿用现有功能、布局和文库。以下区分已修改的行为与实际完成的验证；源码修改完成不等同于原生验收或新版安装已经完成。

## 选区跟随浮层

原浮层的“高亮文本／下划线文本”主要切换标注模式，仍要再次点击保存；这与顶部工具栏的直接操作不一致。点击浮层时，按钮默认焦点行为还可能影响 PDF 当前选区。

现在点击高亮或下划线会使用完整的当前选区、原文位置和所选颜色，立即创建相应批注；颜色按钮保留为颜色选择，不会单独创建批注。按钮在 pointerdown 时保留选区，实际写入仍在 click 时执行。“保存批注”入口保留；同一选区重复点击模式或补点保存不会重复新增，新的选区仍可以继续标注。保存失败保留当前选区并允许重试。

这项修改不改变阅读器的只读权限、来源锚点或其他标注类型，也不依赖翻译成功后才允许标注。

主要位置：

- `reader/src/common/components/view-popup/selection-popup.js`
- `test/node/reader-selection-popup.test.mjs`
- 原生选区操作用例在 `test/tests/researchTranslationViewTest.js` 中核对。

## 筛选、失败和刷新恢复

本轮定位到几项共同造成“空结果后一直无法恢复”的状态问题：

1. 推荐请求成功前就把当前条件记成“已加载”，失败后用相同条件再次加载会提前退出。
2. 多次筛选会先异步保存条件；较早的保存完成后仍可能再次发起请求，取消较新的任务。
3. 已验证 PDF 为空的结果被作为普通成功结果缓存一小时；服务或指标恢复后仍可能沿用这份空结果。
4. 手动刷新只跳过部分题录缓存，没有继续传到 PDF 实际探测，仍可能复用失败结果。

现在把请求中的条件与成功完成的条件分开维护；只执行最后一次筛选保存对应的请求，旧任务及已取消响应不能覆盖新任务。请求失败后清除“已加载”状态，相同关键词和筛选可以重试。空 PDF 批次不再作为长时间成功缓存重复使用。

手动刷新会向下传递到真实 PDF 验证，允许绕过普通短暂网络故障的等待；服务返回的真实 HTTP 429 仍遵守限流冷却，不会用连续刷新轰击来源。筛选无结果时可调整或清除条件后继续搜索。

当前统一检索入口也同步修复：`ui/discovery.js` 在空结果或错误后的下一次显式搜索中传递刷新标记；`xpcom/research/discovery.js` 将该标记传到题录与 PDF 验证，并停止复用备用来源的一小时空缓存。原生回归操作实际 `search` 页面，未把已隐藏的旧推荐入口当作当前检索页面验收。

这里没有把 OA 标记、题录链接或网页地址当成 PDF 成功，也没有为了增加结果数量而放宽实际 PDF 内容检查。无法获取全文仍会明确反馈；空结果、失败和取消分别处理。

主要位置：

- `chrome/content/zotero/research/ui/agent-workbench.js`
- `chrome/content/zotero/research/shared/discovery-feed.mjs`
- `chrome/content/zotero/xpcom/research/discovery.js`
- PDF 验证与请求模块，以及 `ui/discovery.js` 的检索状态衔接
- `test/node/discovery-recovery.test.mjs`
- `test/tests/researchDiscoveryRecoveryTest.js`

## 完成度与 Word 导出

**没有“完成度达到某个百分比才能导出”的人工阈值。** 完成度是模型基于当前稿件给出的估计，并非发表概率。此前界面主要提供“正文与执行方案一起导出”，这个动作要求有当前有效的全文评估；空白待填卡也被一律算成阻断错误，导致已有正文难以单独保存。

现在区分两个明确动作：

| 动作 | 前提 | 输出 |
| --- | --- | --- |
| 导出当前正文 Word | 已有正文，并通过必要的文件、引用和来源检查 | 当前已写内容；不要求 AI 评估，不发生额外模型调用 |
| 导出正文与执行方案 Word | 同上，且有与当前稿件对应的有效评估 | 正文和独立的执行方案文件 |

空白段落、空白标题／列表和空待填卡改成未完成提示，导出副本中跳过这些空模块；编辑项目中的模块、写作要求和素材关系完整保留。非空的待填任务卡不会被悄悄当成已写正文发布。

缺失图片、无效引用、来源冲突、关联素材丢失等错误仍需要处理；只有空白卡的项目仍不能导出成一份假正文。导出失败会说明具体检查项。正文或素材变更后，旧执行方案仍标为过期，但不再阻止单独导出当前正文。

完成度即使是 0%，只要上述必要检查通过，也没有百分比导出限制。文件生成、公式处理或用户取消的错误仍如实返回；执行方案生成失败时会保留已生成的正文路径，不谎称两个文件都成功。

主要位置：

- `chrome/content/zotero/research/shared/manuscript-model.mjs`：未完成提示和独立导出副本
- `chrome/content/zotero/xpcom/research/manuscript.js`：必要检查及真实文档请求
- `chrome/content/zotero/research/manuscript/main.mjs`：单正文／双文档动作分流
- `chrome/content/zotero/research/manuscript/assembly-workflow.mjs`：两个导出入口和禁用原因
- `test/node/manuscript-export.test.mjs`、`assembly-workflow.test.mjs`、`manuscript-assessment.test.mjs`
- `test/tests/researchAssemblyWorkflowTest.js`

## 暗色模式和已加载窗口同步

原实现有两类问题：部分主画布、推荐空态、个性化设置与来源卡使用固定浅色；外观只在部分切换／聚焦时更新，已经加载但未重新聚焦的页面可能停留在旧配色。

现在这些表面分别使用自己的共享颜色变量：主画布用 `--ui-canvas`，空态用 `--ui-tray`，来源卡用 `--ui-card`；阅读器翻译反馈用 `--es-read-*`。不同层级的颜色可以有轻微区别，但要随同一主题切换，不能把所有层级强行涂成同一种背景。

翻译反馈组件会先准备阅读器共享颜色，再加载自身样式；连接失败、超时、质量核对等错误卡和恢复按钮不再仅依赖浅色回退。原生 Reader 的 `data-color-scheme` 纳入颜色优先级；用户显式选择浅色时，不会被系统暗色或其他回退属性覆盖。

`appearance.js` 监听外观偏好的变化，已加载窗口无需重新聚焦即可同步；页面卸载时清理偏好、媒体和焦点监听，避免废弃页面持续占用观察器。本轮改变颜色和材质，不靠修改字体大小、面板几何或重排功能来掩盖主题问题。

主要位置：

- `chrome/content/zotero/research/appearance.js`
- `chrome/content/zotero/research/library-workspace.css`
- `chrome/content/zotero/research/shared/surface-tokens.css`
- `chrome/content/zotero/research/shared/reader-surface-tokens.css`
- `chrome/content/zotero/research/shared/translation-feedback.mjs` 与 `translation-feedback.css`
- `chrome/content/zotero/research/manuscript/assembly-workflow.css`：新增导出按钮沿用现有主题
- `test/node/research-appearance.test.mjs`
- `test/tests/researchAppearanceTest.js`

## 验证状态

以下是本记录编写时已经取得的结果，不把待跑项目计为通过：

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| 扩大后的定向 Node 回归 | **328/328 通过** | 包含选区、检索恢复、导出、主题同步及相关现有回归；不是全仓库所有测试 |
| 原生装配流程 | **9/9 通过** | 真实 Zotero／Gecko 控件；包含未评估正文的实际导出动作；部分模型与文档引擎为受控替身，不等于完整付费论文生产验证 |
| 文档导出 Python 检查 | **5/5 通过** | 见本轮 `document-export.log` |
| 原生翻译与选区浮层 | **20/20 通过** | 内置真实 PDF 自包含夹具；包含 Gecko 坐标合成鼠标命中、pointerdown/up/click、完整选区与即时保存；不是硬件鼠标自动化 |
| 原生暗色同步 | **3/3 通过** | 独立 `researchAppearance`；真实 computedStyle、工作区样式顺序与翻译反馈组件，受控展示夹具，不启动搜索或模型 |
| 原生检索恢复 | **4/4 通过** | 实际统一检索页面；筛选清除、同词重试、可见重试按钮和迟到响应；受控响应，不联网、不调用模型、不下载文件 |

本轮证据目录：`E:/workspace/zotero-main/output/interaction-theme-repair-2026-10-28/`。已生成的 `node-expanded.log`、`document-export.log` 和测试构建日志保留。原生报告从隔离测试文库汇总；主题套件另输出 `research-appearance-acceptance/report.json` 与浅色／暗色截图，检索恢复套件输出 `discovery-recovery-acceptance`。

最终隔离运行 `interaction-theme-1028-e-final` 四套原生测试共 **36/36 通过**；它是上表原生各行之和，不与之前重复运行相加。初次夹具失败、修复及重跑日志完整保留。主题切换还核对正文对比度、字号、字体、圆角和面板几何，未用换主题改变布局。

这些结果不代表所有窗口已经逐页人工检查，也不代表所有在线来源都能下载。正式构建与交接安装包信息见本轮交接目录中的安装验收报告。
