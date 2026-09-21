# 研究生组会 PPT：前台实施方案

2026-09-06。沿用 Zotero 的窗口、工具栏、论文右键菜单和工作台标签页。四个入口进入同一份可恢复草稿，旧组会工具保留为高级功能。

## 用户路径

选择材料 → 内容模板和视觉模板 → 编辑并确认大纲 → AI 补充正文与论文素材/示意图 → 我的理解与实验（可跳过） → 逐页编辑与导出。

AUTO 是预填参数与可检查的内容生成，不绕过大纲确认。默认 15 分钟、单篇精读、学术浅色、130–220 字正文。没有证据时标记待核对，不凑实验结果。可在任一步保存草稿，失败后从未完成页面继续。

## 模块

- shared/ppt-model.mjs：内容/视觉模板、来源类型、页面校验。
- xpcom/research/ppt-studio*.js：草稿、来源采集、远程 DeepSeek、单页缓存和入口。
- research/ui/ppt-*.js：六步流程、素材与用户内容、三栏逐页编辑、X6 示意图。
- services/research-engine/src/studio-*.mjs：ELK 布局、可编辑 PPT、导入主题、独立页面渲染。

新草稿有独立页 ID、历史版本、每页生成状态与渲染哈希。改变一页只重新请求/渲染这一页。最终导出组合当前全部页面，不重新调用 AI。正文的论文事实、作者解释、系统归纳、我的理解、我的实验、待验证观点分别标识。

## 复用依据

- [ArcDeck](https://github.com/RehgLab/ArcDeck)：采用先确立叙事与页面预算再分配材料的设计，不引入其本地文档模型。
- [SlideGen](https://github.com/Y-Research-SBU/SlideGen)：借鉴大纲、图表匹配、公式解释、讲稿分工，合并为受约束的逐页任务。
- [PPTAgent](https://github.com/icip-cas/PPTAgent)：参考模板的内容槽位与可检查生成过程。
- [Presenton](https://github.com/presenton/presenton)：模板预览与生成后编辑流程。
- [PPTist](https://github.com/pipipi-pikachu/PPTist)：参考左侧页列表、中间预览、右侧属性与历史操作。保留 Zotero 控件，不启动其独立 Web 服务。
- [X6](https://github.com/antvis/X6) 与 [elkjs](https://github.com/kieler/elkjs)：直接依赖，分别负责节点/边编辑和分层正交布局，AI 不填坐标。
- [draw.io Integration](https://github.com/jgraph/drawio-integration)：采用宿主持有图形数据的原则，导出可再次编辑 XML；不将论文发送给在线编辑器。
- [PptxGenJS](https://github.com/gitbrent/PptxGenJS)：沿用原生文字、形状、图表与母版导出。

不将“参考设计”宣称为运行了上游完整代理或训练模型。X6/ELK 是确定性工具，不下载本地大模型。

## 验收

原生窗口测试四入口、六步、修改大纲、用户实验页、非空图形与节点编辑、单页重新生成、草稿恢复、缓存与可编辑导出。以真实论文生成 PPTX 并逐页渲染，保存实际窗口截图。在线 AI 测试与离线结构测试分开报告。
