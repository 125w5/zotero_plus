# 论文素材与原生交互：2026-09-06

本轮在 Zotero 阅读器与现有组会标签页内增量实现，没有另开主程序。主分支之外的本地修改尚未推送 GitHub。

## 入口与实现

| 用户入口 | 当前行为 | 边界 |
|---|---|---|
| PDF 顶部「论文图表」 | 图、表、公式候选与缩略图；图号/图注搜索、类型筛选；宽窗口并排停靠，不盖住论文 | 自动匹配是候选，需核对。复杂表格、多面板定位仍可能不完整 |
| 原图附近悬停按钮 | 打开对应素材；选中正文 Figure/Table 引用时可定位原图 | 手动旋转页面的悬停定位暂不启用，可用顶部入口 |
| 素材「查看高清与裁切子图」 | 拖动框选，保存新的高分辨率 PNG；保留矢量 SVG；不覆盖原图 | 不提供像素级图像编辑器；子图标签只作候选提示 |
| 确认素材并加入 PPT | 保存已确认素材；再次点击撤销选择 | 撤销选择不删除受保护的素材副本 |
| 素材「更多」 | 按图注和正文解释、来源页码、模型/时间/缓存状态、保存论文笔记 | DeepSeek 当前文本接口没有看到像素，不声称完成图片语义识别 |
| 组会「选择论文原图生成讲解页」 | 使用已确认原图创建页面计划；至少 60% 视觉证据页、禁止连续三页相同布局；原图缺失不替换为假统计图 | 比例检查按页面种类计，不等于独立事实审查 |
| 每页「调整本页布局与讲述重点」 | 10 个受约束布局入口、第二张图/子图选择、用途与讲述重点、应用和撤销；变更后标记旧渲染 | 缩放对比必须选择原图及其子图；正文结论仍需人工核对 |
| 导入 CSV/XLSX/JSON | 真实数值快照；新增散点图、热力图；保留原生数据、来源、用户提供的单位/样本量 | 目前最多 30 行/5 系列，热力图最多 10 行；拒绝缺失值与 Excel 公式。ROC、生存分析、误差线等专项图尚未实现 |
| 任务反馈 | 素材提取页进度、失败原因、取消和重试；组会右下角反馈；不自动覆盖文稿 | 非产物类旧任务的取消能力仍受原有 AI 服务实现约束 |

## 原图提取与缓存

使用固定版本 PyMuPDF 1.27.2.2，借用其 `get_image_info`、`cluster_drawings` 和区域渲染；保留可提取的内嵌原图与原始分辨率，组合图保留矢量区域和高分辨率裁切，绝不把所有整页截图当 Figure。图注识别采用有限规则，不宣称通用语义解析。参考：[官方 Page API](https://pymupdf.readthedocs.io/en/latest/page.html)。

SQLite 索引和大文件位于 Zotero 数据目录 `easysch/asset-cache`。原始索引绑定 PDF SHA-256 与提取器版本；AI 结果绑定模型、接口、提示词/结构版本、素材和上下文哈希。缓存 30 天未使用视为过期；可查看大小、清理当前论文、清理全部自动缓存、重新提取。手动及确认素材受保护。

完全相同的页面计划、素材和证据复用实际 PPTX 预览。**目前改变一页仍重新渲染整套 PPTX，尚未实现逐页增量渲染。** 已确认旧素材会保留，不因 PDF 变化被物理删除。

## 视觉检查与真实示例

示例文件：父工作区 `output/camc-paper-visuals/presentation.pptx`，基于用户提供的 Hunmin Lee《C-AMC: Towards Complete Automatic Modulation Classification》。5 页中 4 页采用原文 Fig. 1/4/5/7，另一页是核查问题；没有生成实验数值。PDF 页码包括前置页，因此与印刷页码可能不同。来源链接对应主文库附件 `YK7KSJN5`。

使用 PptxGenJS 原生文字和来源链接，原图保留比例，LibreOffice 逐页渲染。检查涵盖页数、空白、文字边界、疑似文字重叠及原图 DPI。**尚无远程视觉模型自动审查/返工，不能证明所有图例或图文结论正确。** 已人工查看示例各页的原图、坐标轴、图例、来源和文字布局。

## 自动验证

- `services/research-engine/pdf/test_assets.py`：重复缓存命中、PDF 改变后失效、清理后手动素材仍存在；CSV 真实值与 XLSX 公式拒绝。
- `services/research-engine/test/engine.test.mjs`：证据/数据校验、60% 与重复布局限制、散点图与热力图原生对象、DSH 导出和 LibreOffice 渲染。
- 原生 `researchWorkstationTest.js`：实际 Reader 入口、图片加载、悬停、画布裁切、素材组会按钮与实际预览；保留 PDF、DOCX、动态研究集回归。
- 本机结果：Python 2/2、Node 产物引擎 4/4（配置实际 LibreOffice）、原生 9 项通过；1 项在线服务测试未启用，按配置跳过。远端 CI 尚未运行。

## 安装与维护

`scripts/setup-paper-assets.ps1 -Python <Python3.10+路径>` 创建父工作区 `.tools/pdf-assets-env`，安装固定版本 PyMuPDF/openpyxl；`launch-research.ps1` 将路径写入本地配置。Node/PPT 与 LibreOffice/Poppler 沿用已有配置。所有模型推理继续使用远程服务，不下载本地权重。凭据和二进制依赖不提交 Git。

新增模块分离为 Python 素材/数据解析、SQLite 缓存、原生 Reader 控件、共享主题样式、页面布局与数据图渲染。没有修改 Zotero Reader 子模块的公共插件接口。

## 本轮交互细节

延续 Zotero 菜单、标签页、主题颜色和字体。搜索框适配深色背景；长图注与缓存操作折叠；Esc 关闭素材栏并恢复工具栏焦点。宽窗口中素材栏让出论文空间，组会预览使用主要宽度，导师追问为较窄侧栏。悬停按钮保留短暂移动时间，便于点选。源码启动器刷新 Gecko 启动缓存，不清理文献素材缓存。

鼠标验收使用当前 Gecko 的 Window.synthesizeMouseEvent，参考 [Mozilla EventUtils](https://github.com/mozilla-firefox/firefox/blob/main/testing/mochitest/tests/SimpleTest/EventUtils.js)，避免仅直接调用处理器。截图来自实际 Zotero 窗口。

真实窗口截图：[素材栏](screenshots/paper-assets/reader.png)、[裁切子图](screenshots/paper-assets/crop.png)、[组会实际预览](screenshots/paper-assets/ppt.png)。最终原生回归日志：父工作区 .tools/research-native-test-profile/stdout.log（2026-09-06 18:10，9 通过、1 跳过）。

