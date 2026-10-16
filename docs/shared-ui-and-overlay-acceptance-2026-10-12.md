# 共享对话与原生同页工作区验收（2026-10-12）

本轮接续现有 EasySch 本地修改，默认白色，保留文库、阅读器和论文装配的既有布局与数据。本文记录共享对话、装配底部区域及论文创建/组会 PPT 的界面行为和检查边界。未提交或推送。用户后续授权的正文生成与重写采用可审阅候选，不直接覆盖人工正文；未启用图片生成。

## 本轮界面与交互

- 用户后续要求以原生“我的文库”承载工作台。论文项目列表、创建下一步、PPT 的完整准备/编辑、文献搜集和研究对话现在直接使用文库内容区，保持原生左栏，不打开工作台标签页或模态覆盖层。真正进入论文装配编辑器时仍保留独立编辑能力。
- 页面及样式准备好之前保持隐藏；加载中返回文库后，后台完成不能重新切走或留下覆盖层。原生列表不重建，其选择、筛选、排序和右栏/分隔条状态保持。
- 同一个工作区持续保留未提交表单、光标、对话输入和 PPT 草稿。原生左栏顶部提供新对话、默认收起的历史对话；使用现有共享会话。推荐页上滑只滚动文献列表，显式进入和返回对话仍在这个持续保留的页面中完成。
- 装配底部聊天的中心消息与输入区域由原侧栏的边界决定，与正文和已有对话保持对齐。左右叠卡只覆盖底部区域，保留上方素材、正文与详情的实际空间。
- 共享对话使用同一会话数据与消息内容。消息拖入装配时可保存为笔记素材，保留问题与回答、TeX 公式和来源锚点，不只保存一张公式截图或一段脱离问题的回答。
- 默认白色，统一控件字体、灰色图标、间距与圆角。外层功能面、内层内容卡片和底部叠卡区分表面层次；玻璃和阴影用于说明层级，不引入另一套独立页面风格。

## 已完成的检查

以下为各套件自己的最终结果，含重叠覆盖和独立复跑，**不相加为一次全套通过的总数**。真实服务连接单独列在后面的检查部分。

| 套件 / 范围 | 最终结果 | 主要覆盖与边界 |
| --- | ---: | --- |
| 原生同页工作区 Node | 7/7 通过 | 同一 iframe、加载取消、原生状态恢复、推荐进入对话、全选、项目准备、实际公共路由与重载重新绑定；未启动应用 |
| 原生同页工作区 Gecko | 9/9 通过 | run-2 已覆盖历史图标尺寸及基线、真实原生窗口、创建下一步、全宽、PPT、表单及光标保留 |
| WorkspaceOverlay（旧需求） | 历史 11/11；显式兼容 2/2 通过 | 后续需求已改为原生同页；旧 11 项不代表当前默认打开方式。显式覆盖层模块 2 项直接调用在 run-1 通过 |
| Assembly refinement | run-4 15/16 | 同素材模式切换位置、卡片等高与顺序已通过；底部原栏命中被临时通知覆盖，修正验收前置后待复跑 |
| AgentWorkbench | run-4 17/17 通过 | 同页入口、真实公共检索与自动分页、消息左对齐、完整会话及模型选择恢复、入口不自动提交 |
| 准备页会话迁移 Node | 6/6 通过 | 旧准备页元数据保留、延迟原生恢复、初始化失败隔离、项目/草稿不改写与监听清理 |
| Integrated non-overlay | 36/36 通过 | 组合检查中的非覆盖层部分；这是该部分的结果，不代表早期整个组合日志全部通过 |
| RapidReading | 14/14 通过 | 速读相关结构、展示与交互；使用受控来源/模型数据的部分不代表真实学术质量验收 |
| Shared chat / Logo / ReaderInteraction | 实际执行 37 项通过，2 项 opt-in 跳过 | 共享消息、Logo 与阅读器交互；跳过项不记为通过，不替代真实联网检查 |
| Node | 203/203 通过 | 当前 node-final.log，新增本轮发送选项与准备页会话恢复检查；与原生和服务检查存在功能覆盖重叠 |
| 服务检查 | 159/159 通过 | 服务层检查；不等于真实供应商连接已经通过 |
| Offline stream | 4/4 通过 | 原生 sandbox 与生产解析器，含 43 帧重复工具标识；两次离线响应、一次准确工具执行 |
| 工具标识回归 | 67/67 通过 | 函数名与 ID 的分片/重复快照、参数准确性及严格拒绝冲突、超限、未声明工具 |
| 对话保存最终复验 | 1/1 通过 | 本轮笔记元数据修正后，原生消息拖入装配保留问题、TeX 与引用锚点 |
| 后台产物服务 | 4/4 通过 | run-2 已复验冷题录真实 PDF 索引、无主窗口/无启动定时器的本机引擎、标准 Base64 与 MIME，未再见主窗口 AbortController 异常 |
| 当前 Pi / 对话服务回归 | 89/89 通过 | service-final.log，含实际下一轮请求中的用户选择记忆；不等于真实联网学术质量检查 |

WorkspaceOverlay 最终日志为：

`E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\overlay-final-passed.log`

日志第 2089 行为 `11/11 tests passed`。对应报告：

`E:\workspace\zotero-main\.tools\research-native-test-data\workspace-overlay-acceptance\report.json`

报告记录 11 项 `passed`，`modelRequests: 0`。RapidReading 的最终日志：

`E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\rapid-final-passed.log`

日志第 3838 行为 `14/14 tests passed`。其他结果的依据：

- `E:\workspace\zotero-main\.tools\research-native-test-data\assembly-refinement-acceptance\report.json`：13 项 `checks` 全部为 `passed`；消息转移记录包含问题、可编辑 TeX，`generatedProse: false`。
- `E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\integrated-initial.log`：5 个 non-overlay 套件为 36/36；该次 overlay 为 10/11，整次为 **46/47**。
- `E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\reader-overlay-initial.log`：shared chat / Logo / ReaderInteraction 实际执行 37 项通过，2 项 opt-in 跳过；该次 overlay 有 5 项失败，RapidReading 有 1 项失败，整次为 **56/62**。
- `E:\workspace\zotero-main\.tools\current-node-qa.log`：167 项测试、167 通过、0 失败、0 跳过。
- `E:\workspace\zotero-main\.tools\current-service-qa.log`：159 项测试、159 通过、0 失败、0 跳过。
- `E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\provider-offline-stream-final-passed.log`：4/4；对应 `provider-offline-stream-acceptance/report.json` 记录 43 个工具标识帧、2 次离线响应、1 次工具执行。
- `E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\provider-tool-identity-service-regression-67-passed.log`：此前实际工具输出的白名单摘录和 67/67 总数，文件明确标注为 transcript excerpt，不是另一次新运行。
- `E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\assembly-message-transfer-final-passed.log`：1/1，保留了问题、回答、TeX 与引用锚点。
- `E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\artifact-background-final-passed.log`：3/3。后续新增的真实冷题录 PDF 索引用例仍待构建运行。

## 旧失败与最终复跑的关系

早期组合日志保留了失败，不能以本表的独立复跑结果把这些旧日志改称全绿。`integrated-initial.log` 的整次结果为 46/47；`reader-overlay-initial.log` 的整次结果为 56/62。表内的 36/36 和 37 项实际执行通过分别只描述这些组合中的相关子套件。

覆盖层检查曾因受控启动承诺在截图 PNG 编码和关闭存储刷新期间仍未释放而超出原有启动期限；恢复的历史装配标签还引入了不相关的后台模型尝试。此后提前释放测试承诺，隔离测试窗口的会话恢复与无关预处理队列，并在关闭后显式建立原页焦点。RapidReading 的旧失败也采用修复后的单独 14/14 结果，保留原日志用于审计。

以上修正保留了生产启动期限和原有焦点/草稿断言。覆盖层最终单独复跑 11/11 通过，且没有模型请求。其他组合检查按表中的实际子范围与最终独立结果记录，不把重叠套件、先前失败和跳过项合并成一次成功运行。

### 本次新增控件的首轮原生验收

`E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\run-1\stdout.log` 的整次结果是 **47/53**，不能称为全绿。六项失败分别是：默认素材讨论被写作策略误拦截、问题卡片操作行在扩展动效中被裁切、工具叠卡未展开、素材导航底色被通用样式覆盖、收起抓手未响应原生 iframe 键盘焦点，以及截图通知使无变化的旧项目重复保存。

已修正默认讨论的否定措辞，并以真实写作策略验证四阶段请求；操作卡片在高度变化时保持可见，工具与抓手使用实际鼠标/焦点事件；素材导航恢复独立底色。截图通知的重复保存修正和最终原生复跑结果将在完成后记录。首轮真实 paper/material 引用、选文字与拖整卡区分、100×60 与 120×80 精确截图像素、Pi 工具循环、9 项同页集成及 2 项显式浮层兼容均已通过。

首轮还发现冷索引后台的两个 AbortController 主窗口依赖。译文与速读现使用窗口无关控制器，退出会取消并等待已经启动的任务；43 项后台生命周期相关离线检查通过，最终原生复验待执行。新增研究选择记忆只保留最多 10 条用户实际选择，JSON 总计不超过 6000 字符，不纳入思考字段、取消、重新生成或陌生来源。

当前 Node 日志：`E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\node-final.log`，203 项通过，0 失败、0 跳过。该结果不替代原生复跑或真实模型解释质量验收。

### 第二轮扩大原生范围

`run-2\stdout.log` 为 **95/101**，另有 1 项 opt-in 跳过，不能把跳过计入通过。各子范围：Composer 5/6、Refinement 14/16、ChatAttachments 5/5、Pi 7/7、Library 9/9、Artifact 4/4、ConversationSurface 11/11、ReaderAIOrb 11/11、AgentWorkbench 14/17、RapidReading 14/14、EditorLifecycle 1/1。

素材导航底色、问题卡片及截图导入已通过真实原生复验。截图导入严格比较了全部已有项目，包括 revision、updatedAt、正文及全部目录字段；没有放宽为只比较正文。新截图只在全局素材库中，没有自动加入项目。源记录、PDF 哈希及中心像素也保持。

剩余六项为工具叠卡焦点、搜索历史失焦、收起抓手焦点，以及三项旧 AgentWorkbench 原生入口/预览检查。检查源码确认 Windows 后台主窗及未激活的 iframe 不派发 focus/blur，已按项目已有 activateZoteroPane 方式修正测试前置条件，保留真实焦点、宽度、命中与收起断言，待最终复跑。新默认同页工作区的验收也需要同步替代旧页面入口，不能仅删掉断言。

已查看 run-2 的 `native-inline-project-management.png`：历史按钮为 34×34 图标，与新对话同高；没有项目时有统一空状态。`native-inline-conversation.png` 当时仍处于准备画面，不作为完成状态截图；对话截图的完成条件待修正。

### 第三轮聚焦原生复验

`run-3\stdout.log` 为 **43/48**：Composer 6/6、Refinement 15/16、AgentWorkbench 13/17、Library 9/9。叠卡展开、真实焦点命中、问题选择和截图已通过；素材切换后的同一张卡片仍偏移 24 px，保留 3 px 容差和卡片等高断言继续修复。

AgentWorkbench 的四个失败来自一次搜索误走普通对话后的连锁结果。发送期间打开论文作用域会话会恢复旧功能选择，覆盖当前的检索模式。现已在发送开始时保留功能、模型、推理强度及操作权限；两项使用真实会话服务和发送方法的 Node 行为检查修前复现、修后通过，原生搜索、分页、历史恢复与不自动提交的断言保持，最终复验待执行。

素材结果改为完整构建后一次提交，避免清空列表造成滚动位置被浏览器夹回；素材侧栏关闭与显式位置恢复冲突的浏览器自动锚定。新增分阶段位置诊断，失败时保存原现场，不放宽位置断言。

已查看 run-3 的 `native-inline-conversation.png`：实际对话已加载，同页原生左栏、左对齐消息和底部输入框可见。`assembly-chat-original-sidebars.png` 保留上方素材和详情原栏，底部聊天中心由两栏边界决定，没有默认用叠卡盖住原栏。

### 第四轮原生复验

`run-4\stdout.log` 为 **41/43**。实际执行：Refinement 15/16、AgentWorkbench 17/17、Library 9/9，另有新增准备页会话迁移 suite 的 before hook 失败；其两项正常测试当时没有执行，不能记为通过。

检索、分页、完整会话恢复、入口不自动发送已全部通过。模式切换诊断记录同一素材从简述到来源再切回时保持 `scrollTop: 620`，相对于固定控件的偏移为 `-5.8000030517578125`，没有前次 24 px 跳动；原 3 px 容差及卡片等高检查未放宽。

剩余两项为验收前置问题：素材栏命中点落在可点击关闭的临时 `#status` 提示上，原生失败截图中左右栏已正常打开；会话迁移 before hook 在上一 suite 已关闭最后主窗后调用 `attachWindow(null)`。前者通过真实通知关闭操作和测试状态恢复处理，原命中坐标/高度/叠卡断言保留；后者改为窗口无关服务初始化，真正恢复仍使用真实新窗口。没有添加假窗口或改变产品命中行为。最终这两个 suite 待复跑。

已查看 run-4 的 `left-aligned-conversation.png` 与 `assembly-material-controls-scrolled.png`：检索消息和输入框共用左边界，正文没有玻璃滤镜；素材列表滚动中，模式和筛选控件留在可见顶部。

### 第五轮原生复验与 clui 参考修正

`run-5\stdout.log` 为 **29/29**：Composer 7/7、Refinement 16/16、准备页会话迁移 2/2、公式编辑 4/4，无跳过。第四轮的两处验收前置失败已通过真实窗口、通知关闭及状态清理复验；历史失败日志仍保留。

实际打开并查看了用户提供的 [clui-cc 演示](https://www.youtube.com/watch?v=NqRBIpaA4Fk)，观察了约 0:20 的收起任务条与固定输入栏、0:39 的上方功能卡片、1:18 的截图缩略图、1:50 的展开消息与底部配置、2:06 的命令弹层。同时对照本地 `cankao/clui-cc-main/clui-cc-main` 的 `TabStrip.tsx`、`App.tsx`、`ConversationView.tsx`，保留本项目白色界面和应用内置研究操作。

当前任务采用实体表面，其余任务保持轻量；已有标签使用稳定 DOM、固定顺序，切换或流式回复不将当前任务挪到首位。方向键实际切换共享对话，更新消息保留键盘焦点。中间及两侧采用相同玻璃背景、15px 圆角和模糊参数，正文保持可选择。44px 的顶部收起区域默认不显示大按钮，悬停或聚焦显现 66×34px 抓手；两侧均为 44px 标题区与可实际命中的 36×36px 关闭按钮。右侧只显示一次“判断依据”，计数取实际回答引用，未引用的候选来源不计入。

公式空态不再显示“可编辑公式”及“输入 LaTeX 公式”。原位单击输入、无强制右栏、论文/定理检索、导入可编辑 LaTeX、复制源码和带来源的公式解释均通过原生检查。

已目视检查本轮 `assembly-composer-stable-task-cards.png` 和 `assembly-console-wide-collapse-glass-edges.png`：任务条与消息层次分明，两侧原栏在默认状态保留；显式打开的侧卡与中间卡统一表面，依据标题没有重复，底部输入基线固定。

补充只读审查发现：执行 A 对话时切到 B，原全局状态点会误标 B，且 A 可能被删除。现将执行状态和删除保护绑定实际发送会话，并在提交前保留发送会话及模型配置。第六轮真实延迟回包原生检查已经通过。

### 第六轮与第七轮原生检查

`run-6/stdout.log` 为 **24/24**：Composer 8/8、Refinement 16/16，无跳过。执行会话的状态及删除保护通过延迟回包检查。

`run-7/stdout.log` 为 **54/63**，保留九项失败。Composer 8/9、Refinement 15/16、WordTools 8/8、ModuleDetails 7/7、MaterialClues 5/10、LibraryWorkspace 11/12；Canvas 的 before hook 失败，其五项用例未执行，不能记为通过。

失败分别为首次发送的模型配置被旧界面快照覆盖；一次原生截图只有 28px；Canvas 在服务初始化前取得会话引用；五项素材检查仍在原文区寻找已移到独立说明区的中文说明；新建会话尚未完成就进入历史验证。全部原始日志、报告和证据在 `run-7` 留存。滚动素材截图文件时间早于 run-7，是旧轮次遗留文件，不作为本轮成功截图。

新增改动包含同章拖放落点与续页、素材/正文可逆视图、来源原文默认折叠、选中模块的来源及写作工具、明确分离文献搜集和推荐、页内项目卡片及创建。人工正文、来源身份、公式源码与导出内容有单独保留检查。右栏选择跟随实际模块，旧控件或延迟文件选择不能修改后来选中的模块。

第七轮工具栏原先按全宽设计通过检查；用户随后明确要求只在中间文章栏显示。当前源码改为文章栏内的覆盖式工具栏，默认点击外部自动收起，右下角图钉可固定，窄窗口侧栏随宽度缩小。此后新增的推荐卡片、来源订阅和真实插页工具仍须独立构建复验，不能以 run-7 结果替代。

### 第八轮诊断与推荐页待验收范围

`E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12\run-8\stdout.log` 第 11179 行记录 **40/43**，不是全套通过。实际子范围为 Composer **7/9**、Refinement **16/16**、WordTools **8/8**、MaterialClues **9/10**。本轮没有执行新版推荐页、Canvas 或新增页工具套件，不能用这个结果代替这些改动的原生验收。

三项失败按原日志保留：功能菜单的键盘打开在 `command-keyboard-open` 等待实际焦点超时（第 3590–3592 行）；共享消息更新后焦点落在 `ai-prompt`，未保留任务按钮的键盘焦点（第 3712–3714 行）；双页素材线索的长原文虽然处于收起状态，内容高度仍为约 **175.27px**，未达到 **0px** 的折叠断言（第 10695–10697 行）。对应快照报告保存在 `run-8/assembly-composer-acceptance/report.json`、`run-8/assembly-refinement-acceptance/report.json`、`run-8/material-clues-acceptance/report.json`。后续修复必须通过新的原生运行验证，不能修改或覆盖这些失败记录。

当前推荐源码按用户的 WisPaper 参考采用居中的研究输入框、趋势/最新/AI 订阅、同页个性化设置与右侧论文首页位置；字体、浅色玻璃表面及灰蓝色图标延续本项目样式。文献搜集继续承担精确检索、题录导入和全文获取，推荐入口不会重复显示搜集结果。主题、学科和真实期刊来源在“应用修改”后保存；学科 ID 来自 OpenAlex `/fields` 的实际响应，期刊 ID、名称及 ISSN 来自 `/sources`，没有编造影响因子、分区、点赞或机构标志。

趋势按近一年引用次数排序，最新和订阅按发表日期排序；来源及已解析的学科使用供应商筛选字段。HTTP 429 保留已有缓存或本地文库论文，标明本地/缓存来源并暂停请求 60 秒，不通过连续重试填空。摘要选取原摘要中的研究对象、方法和数值结果句，并使用现有机器翻译接口；翻译失败保留原句，不生成笼统的替代结论。首页只取已存在的本地 PDF，经 `library.localPDF → firstPage → assets.cover` 获得，未为填充卡片自动下载远程 PDF。没有本地文件时显示“暂无本地首页”。可见卡片按需加载，两个并发任务；卸载会清理观察器、媒体预览与计时器，延迟返回也检查已卸载状态。

新版推荐相关 Node 检查为 **18/18**：推荐服务 8、原生同页宿主 7、共享对话发送 3。覆盖排序与真实来源/学科字段、限流缓存、具体数值摘要和本地附件预览调用路径；预览返回值使用受控夹具，不是实际 PDF 渲染截图。原生 `researchLibraryWorkspaceTest` 仍为 12 项，已加入同页个性化、精确来源 ID/ISSN、三种推荐方式、完整作者、具体中文摘要、讨论/题录/PDF 操作及输入 Enter 接入文献搜集的检查。它的预览服务目前固定返回 `null`，核对无本地 PDF 时的诚实占位；**尚未在该原生套件验证真实本地 PDF 首页的正向渲染分支**。

待原生复跑的新版截图名称是 `native-inline-discovery-personalization.png`、`native-inline-discovery-feed.png`、`native-inline-discovery-latest.png`；已有搜集检查继续输出 `native-inline-literature-collection.png`。这些是源码中的验收输出名称，当前不据此宣称文件已经由新版运行生成，也不以受控摘要质量代替真实联网文献推荐质量。最终构建及后续原生结果另行记录。

另已准备独立的 `researchDiscoveryPreviewTest` 两项正向检查：把仓库 `test.pdf` 导入隔离测试库，保留真实 `localPDF`、`firstPage` 与 `assets.cover` 实现，拒绝外网和模型请求；核对引擎输出文件、卡片图片真实加载、局部悬停预览，以及重绘后旧预览和待触发计时器的注销。预期截图为 `native-discovery-real-local-first-page.png` 和 `native-discovery-real-local-hover.png`，报告位于 `discovery-preview-acceptance/report.json`。这里只记录检查已准备，实际原生执行结果仍待另行追加。

### 第九轮原生检查与两种对话尺寸

`run-9/stdout.log` 实际 **68/74**：Composer 8/10、Refinement 16/16、Canvas 8/10、WordTools 8/9、ModuleDetails 7/7、MaterialClues 9/10、LibraryWorkspace 12/12，没有把失败记为成功。原始日志、报告与截图已独立留存；本轮 Node 为 **240/240**。

新消息阅读尺寸已通过：普通聊天维持用户选择的高度，点击消息正文进入临时更大的阅读区，输入框高度和底边不变；重复点击不继续增长，复制选区、拖动准备、按钮和媒体不触发放大，切换会话或收起恢复普通高度。已目视检查 `assembly-composer-message-reading-size.png`，正文显示数学下标且左右原栏保留。文章栏内自动工具栏、窄窗口控件、图钉与正文选区检查也通过。

真实新增按钮已核对页内首块操作只增加一页、原同页两块不拆散、空章节仍有可编辑页，章节及人工原文保持。受控 Pi 创建并插入引用素材的成功及后续 Ask 拒绝两项仍遇到处理上限，不能据按钮检查声称完整工具链通过。另两项 Composer 失败表现为页面/会话被切换后的模型上下文及实际焦点异常，继续记录调用来源诊断，未通过延时或改选会话掩盖。

其余失败是正文公式复制夹具使用了 Gecko 不接受的 ClipboardEventInit.clipboardData，以及折叠原文 CSS 被更高优先级显示规则覆盖。前者改为读取真实事件的 clipboardData，并增加公式内部部分选区复制完整 LaTeX；后者加上实际详情容器选择器。均待第十轮实际复验。推荐设置及三种 feed 操作 12/12 已通过，已查看本轮推荐截图，真实本地 PDF 首页正向检查另在第十轮运行。

### 第十轮聚焦复验

`run-10/stdout.log` 实际 **39/41**：Composer 8/10、Canvas 10/10、WordTools 9/9、MaterialClues 10/10、DiscoveryPreview 2/2。没有把与前轮重叠的通过项累加成一次运行。

真实 Pi 页操作四工具链已通过：读取绑定章节、实际创建页、重读此前回答中的真实引用、把两份原素材加入该页。操作过程中改选“方法”仍插入原“结果”章节；引用点击定位左栏真实素材，独立的原文操作仍打开来源。Ask 在新增前拒绝不会创建页；新增后拒绝素材放置保留已建页并如实返回部分完成。人工内容在等待期间改变则拒绝继续写入。截图中的页和素材是真实渲染与持久化结果，模型响应仍为受控 Pi。

正文 inline math 的完整复制、内部部分选区复制、富文本编辑/持久化、光标重绘和列表换行已通过。原文折叠的高度及展开均通过。真实本地 PDF 推荐预览走 `localPDF → firstPage → assets.cover`，图片实际加载（561×46，仓库测试PDF本身为狭长页）；悬停局部预览及注销已通过，外网/模型请求均为0。已目视查看本轮实际首页截图。并不以该夹具代表普通论文首页的内容丰富度。

仍有两项 Composer 失败：第一任务发送等待超时与功能菜单实际焦点超时。诊断发现当前 tab 被切到原生文库，继续保留原断言并追踪导航来源；最终修复及构建另行记录。独立审查还发现装配工具不能仅以 live UI 内存判定保存成功，已安排以真实存储快照确认并传播保存错误，须复验后才能声称完成。

## 早期覆盖层截图（后续默认已改为同页）

截图位于：

`E:\workspace\zotero-main\.tools\research-native-test-data\workspace-overlay-acceptance`

已重新查看本轮最终 12:09–12:10 的以下截图：

- `native-workflow-preparing-without-legacy-page.png`：启动时显示当前页面上的覆盖层，旧工作台内容没有露出。
- `native-writing-management-overlay.png`、`native-unsubmitted-create-form.png`：创建管理和未提交输入仍在同页覆盖层内，表单选区可见。
- `native-ppt-wizard-overlay.png`、`native-ppt-overlay-narrow.png`：组会 PPT 保留在当前原生窗口，窄窗口未超出覆盖层边界。
- `conversation-writing-overlay.png`、`conversation-ppt-overlay.png`：从已有工作台对话打开创建与 PPT，原对话保留在底下。

## 真实 provider

真实素材工具循环已通过：保持配置的 `gpt-6-luna` 与 `off` 推理等级，第一次响应调用 `search_local_materials`，第二次响应读取工具结果并返回带来源的回答。两次 HTTP 200 SSE 是正常工具循环，不是自动重试；本机检索执行一次，实际读取一条隔离验收记录。没有替换模型、改变设置或保存生成的论文正文。

安全报告：`E:\workspace\zotero-main\.tools\research-native-test-data\provider-material-tool-probe.json`，`outcome: success`、`networkRequests: 2`、`localSearchCalls: 1`、`argumentFields: [query]`、`citedSourceCount: 1`。请求中没有空消息或无效工具消息。

真实失败根因是网关在多个 SSE 帧中重复发送完整工具 ID 和函数名称；原解析器把完整快照再次拼接，触发名称/ID 长度上限。现在识别相同快照，同时仍校验完整工具参数、声明工具列表、真正的身份冲突、完成标记及长度上限。服务已连接但解析失败也不再被误报为网络/代理不可达。

公式原图解释已完成一次真实复验：`provider-current-visual-final\stdout.log` 为 1/1，报告 `provider-current-visual-probe.json` 记录 `outcome: success`、`networkRequests: 1`、HTTP 200 SSE、1 张原式图片、19 条相邻正文来源（9753 字符）、1014 字符回答与 3 个引用来源。使用原有 `gpt-6-luna`，保留请求的推理配置，不换模型、不续轮、不重试。报告只保存安全诊断与长度，不保存密钥或完整敏感响应。

此前公式失败发生在发送请求前的后台索引阶段：未启动交互窗口时的定时器、AbortController 和冷父题录 itemData 依赖均已修正；run-2 的后台产物 4/4 及速读 14/14 也通过。一次真实视觉请求确认了当前公式详情连接，但不代表全部论文的解释质量、所有阅读器入口或所有供应商 HTTP 400 情况都已验收。

## 验收范围

原生检查使用真实 Gecko 窗口与 DOM，但论文、草稿、来源读取和模型回复有受控部分。覆盖层六阶段控件与入口已覆盖，未验证真实供应商的整套 PPT 生成/导出，也未覆盖所有生产草稿布局。截图证实本轮静态布局；不据此宣称长时间内存、帧率或所有动画都经过量化。

此前轮次 AI 的范围为现有论文解释、检索、核验、对话与素材组织。用户随后明确要求依据装配素材准备正文及改写方案，当前源码已增加受控正文候选预览：至少两个方案，红色删除、绿色新增，选择后明确采用或还原。图片生成仍未启用；人工正文、素材身份与原 PDF 保留。

## 2026-10-13 最新修正与待原生复验范围

顶部流程为素材选择、装配正文、插入图表、验证导出。正文候选生成不直接覆盖人工正文；采用时检查完整来源内容、版本、全部定位、数学源码及当前正文，旧候选继续兼容。候选保存实际引用片段和来源指纹，避免为每个候选复制整篇来源；读取额度按来源轮询分配，明确显示实际读取范围。空占位模块采用候选后转为正文，撤回恢复原模块。

验证导出连接全文完成度、剩余工时区间及前提、条件性期刊定位、执行方案和两份独立 Word。实际对照文献目前读取题录与摘要，明确标记未读取全文；未检索到实际对照时不得声称期刊等级。正文或素材变化后必须重新评估，异步检查与导出也复核当前内容，不仅依赖 revision。未进入验证步骤的编辑不扫描全部来源，验证界面一次渲染复用一次内容签名；编辑入口移除重复流程渲染。

工具区鼠标进入即展开，移出自动收起，固定和工具焦点可保留；展开内容位于文章栏的正常布局中。选中状态统一淡蓝色，移除无语义的左色带。PPT 准备页增加汇报设置和选中论文两列，并保留既有六步功能。文库主列表只显示论文，真实笔记与附件仍归原论文；装配项目和孤立资料通过未关联资料视图访问，不改变存储关系。侧栏主要入口居中，文库启动默认收起；分类搜索位于日常面板上方，创建分类对话框采用统一控件样式。

阅读器翻译请求增加总期限、取消和重试；AI 停靠时隐藏被覆盖原栏的绘制并精确恢复。原生笔记 iframe 加载统一阅读与数学样式，数学显示不改写人工笔记。页外批注按可见页面几何排序，靠近原页，屏幕外批注不占用可见区域。

表格输入、合并与 Delete 同步实际文字和富文本。旧存档导出时发现 runs 与 text 不一致，恢复与实际文字对应的前后缀格式，不再输出已删除或过期文字；最新 LaTeX 继续转换为可编辑 Word 数学表达式。

当前离线结果如下，均不能替代尚未执行的本轮原生窗口复验：

- Node 界面与数据行为 **315/315**，`node-run11-final2.log`。
- 服务行为 **389/389**，`service-provider-fixtures-after-20261013-213611.log`。初次服务扩大检查 **342/388**，46 项失败及挂起日志仍保留；过期夹具已对接实际最新模块和 API，未修改生产保护策略以通过测试。
- Python Word 导出 **18/18**，`python-run11-final.log`，包含实际 Pandoc 可编辑 OMML；PDF 章节解析 **11/11**，`python-material-run11.log`。
- 两份默认 Word 样本已由随附 LibreOffice 和技能 renderer 实际渲染，每份一页且逐页查看：黑色标题、灰色页眉、正文和表格公式可见，样本无缺字或溢出。`docx-qa-current/manuscript/page-1.png` 和 `docx-qa-current/plan/page-1.png` 为受控排版样本，不是用户论文评估结果。

证据根目录仍为 `E:\workspace\zotero-main\.tools\ui-current-repair-2026-10-12`。本轮首次构建被正在运行的日常 `research-native-profile` 阻止，未替换正在使用的程序文件；本轮原生验收结果及正式构建状态须在执行后另行追加。

### 第十一轮原生扩大检查

用户退出后测试版成功构建。`run-11/stdout.log` 实际 **142/153**，另有两项真实翻译服务 opt-in 跳过，均未计入通过；原生文库组织 before hook 的路径分隔符错误导致其四个正常用例未执行。失败和当前时间生成的报告、截图已单独归档，未覆盖此前轮次。

Composer 10/10、Canvas 10/10、WordTools 9/9、ModuleDetails 8/8、MaterialClues 10/10、LibraryWorkspace 12/12、TranslationView 17/17、ConversationSurface 12/12 已通过。剩余范围为 RapidReading 13/14、DiscoveryPreview 0/2、AssemblyWorkflow 5/6、ReaderInteraction 13/16、文库组织 before hook 失败、ManualAuthoring 19/21、AssemblySurface 4/5。不能把本轮局部通过称为所有新改动已通过。

已目视核对本轮窄栏工具区、消息阅读尺寸、四步与全文评估界面。工具展开位于文章栏内并保持两侧原栏；消息阅读区使用更大临时高度，输入框底边保持；全文评估与执行方案在当前详情栏显示。项目卡片新截图发现真实问题：旧 `#manuscript-projects .project-card` 的 grid 优先级覆盖新卡片 flex，使标题和统计在窄窗口重叠。已提高当前嵌入布局的选择器优先级，并添加宽、窄窗口卡片各行不重叠的几何断言，待下一轮复验。

阅读器保存笔记使用了全局第一个相同 PDF reader，多个恢复标签存在时可能把笔记打开在另一标签。当前修正优先当前窗口的可见 reader，排除已关闭与未初始化 reader；原生保存笔记、连续保存及图片笔记仍需下一轮确认。两项纯函数回归已验证同 PDF 多标签及无有效 reader 的边界。

其余夹具问题已按当前真实控件更新：批注宽度随窄栏变化；正文保留直接比较原始文字而非含 JSON 转义的文本；文库 PDF 使用 PathUtils.join；默认隐藏的模板和插入工具通过实际按钮展开后测量；空段落不再生成无意义 badge。推荐首页夹具禁止导入索引任务，同时继续保持外网和模型请求必须为零的原断言，并记录调用路径用于排除跨用例任务。下一轮执行结果尚待追加。

当前更新后的离线同次运行 **706/706**，`node-service-run12.log`，不包含原生测试或跳过项。

### 2026-10-14 聚焦复验与正式构建

第十二轮 `run-12/stdout.log` 为 **76/80**，另有两项在线翻译 opt-in 未启用。RapidReading 14/14、LibraryWorkspace 12/12、DiscoveryPreview 2/2、AssemblyWorkflow 6/6、ReaderInteraction 16/16、ManualAuthoring 21/21、AssemblySurface 5/5 均通过。真实笔记保存、连续保存及图片笔记现在打开在当前可见阅读器；推荐真实本地 PDF 首页与悬停预览仍保持外网和模型调用为零。宽窄项目卡片均有标题、统计、状态与操作区域不重叠的几何检查，并已目视检查窄窗口截图。

该轮文库组织四项失败保留在原日志：前三项使用了不存在的 `row.isItem`，导致夹具读出的条目 ID 全为空；最后一项发现真实问题，新建分类仍插在“最近阅读”之后。条目夹具改用真实对象行类型，分类的即时插入顺序与完整刷新一致，均未删除原断言。

第十三轮文库组织的 before hook 在 90000ms 超时，`run-13/stdout.log` 为 **0/1**；四个正常用例未执行，不能记为通过。启动时原同步逻辑对积累的项目逐条强制重载 itemData。现批量加载已有项目题录，保留 Zotero 数据缓存，并让多个窗口复用同一同步任务。修改保留用户手改题录标题与主动放入回收站的条目，不改正文或素材。新增冷启动、并发窗口、手改标题/回收站及失败后重试检查，与文库范围检查同次 **7/7**；不把它和此前 706 项相加称为同次运行。

第十四轮在真实同步路径下文库组织 **4/4**。测试库的持久研究夹具还留有旧数据库项目编号，因此第十五轮阻止启动无关旧项目迁移，只验证本轮真实创建的项目；实际 `ensureLibraryItem`、原生条目通知、关系、分类插入与视图逻辑均未替换。第十五轮仍为 **4/4**，无失败或跳过；`run-14`、`run-15` 分别留存独立日志，不能累加为八项不同检查。

最终正式构建已使用 `scripts/build-native.ps1 -Incremental` 成功完成，未带 `-Test`；日志为 `build-production-final.log`。随后以 `scripts/launch-research.ps1` 重新打开 `.tools/research-native-profile` 日常文库，使用 `.tools/research-native-data`，未以隔离测试库替代日常数据。所有修改仍保留在当前工作区，未提交或推送。
