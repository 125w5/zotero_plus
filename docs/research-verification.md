# 源码版验证记录

验证日期：2026-09-05。平台：Windows x64。源码基线：`fc17dcd24ad34686cb24e6b3ffb06a6a7a5e0e5d`，版本 `11.0.SOURCE`，Gecko `153.1.0esr`。不是早期 Zotero 7 插件测试结果。

## 已验证

官方前端构建及 Windows 原生 staging 构建成功。下载了官方 Firefox 运行时与 Zotero 自定义组件，组件按上游脚本检查 SHA-256。构建缓存修复后，`.mjs`、HTML、FTL 等非 JS 文件的源码变更能进入 Windows 程序。

`researchWorkstationTest.js` 通过 8/8 个原生集成测试组：

1. 用户 C-AMC PDF 副本：第一页 canvas 实际完成渲染，官方字体成功载入，原生 worker 提取正文，高亮写入测试资料库；截图确认。
2. 彩色原生标签、分钟时间格式和无效日期拒绝。
3. 真实服务：DeepSeek 对话和结构化分析（返回 4 节、绑定证据并持久化）、有道短句翻译、easyScholar 查询 Nature（不保存测试指标到文库）；PubMed/arXiv 各返回 10 条并成功导入。默认测试跳过网络，必须显式 `-LiveServices` 才执行。
4. 独立 SQLite 指标表、历史年份指标、ISSN 校验、阅读状态持久化；不写 Extra。
5. DOCX 段落、标题样式、表格、批注、引用域提取；排除修订删除文字；原生全文搜索命中；独立 DOCX 及子附件进入 AI 证据采集。
6. 原生列读取与显示、科研侧栏数据刷新、主窗口工作台标签页和组会 UI；运行时截图检查，修复侧栏本地化布局问题。
7. 组会项目、会后任务、连续问答历史，以及未回答时阻止重复追问。模型响应使用测试替身，无真实 LLM 调用。
8. 调用实际 Pandoc 导出 DOCX/PPTX/LaTeX；检查 DOCX 包中的 Word 原生数学元素 `m:oMath`。

测试使用独立 `research-native-test-profile` 和 `research-native-test-data`。指标测试数值是明确命名的人工夹具；检索测试题录来自实时公共接口。用户 PDF 仅作为副本导入隔离测试文库，原件未修改。正式资料库未迁移或升级。

## 未验证 / 未完成

- 已验证三项服务的真实调用；模型学术质量、长期配额和服务稳定性不由一次连接测试保证。
- Word 安装器已加入安装检测；未验证本机真实 Office 文档内的引文插入与修复，更没有完成 Word AI 侧栏或修订功能。
- 保留上游插件接口与子模块；没有逐一安装测试 Zotero Style、Green Frog、Better BibTeX、Better Notes、翻译插件。兼容接口保留不等于所有版本兼容。
- 已实现预置列视图和原生列操作；冻结列、用户自定义颜色规则、独立多条件筛选及自定义视图模板仍未实现。
- AI 证据目前基于批注、部分全文和 DOCX 段落；尚未实现完整论文结构/图表解析、全文逐页定位、引用支持程度判断和跨文献向量检索。
- 组会已有项目、大纲、PPTX、连续问答和任务；自动选图、图源审计、实时汇报控制及导师画像尚未实现。
- LaTeX 目前是带模板导出和引用检查；项目文件树、自动 Bib 同步、编译预览及 SyncTeX 尚未实现。
- 未创建远程 Fork、签名安装包或发布更新通道。研究数据当前仅本地保存。

## 参考资料

- 小绿鲸官方页面：https://www.xljsci.com/
- Zotero 原生构建：https://www.zotero.org/support/dev/client_coding/building_the_desktop_app
- Word 安装机制：https://www.zotero.org/support/word_processor_plugin_installation
- 期刊指标能力：https://github.com/MuiseDestiny/zotero-style
- easyScholar 接口及字段对照：https://github.com/redleafnew/zotero-updateifsE/blob/bootstrap/src/modules/examples.ts

内置依赖：Marked 15.0.12、DOMPurify 3.4.14、KaTeX 0.18.5；已随 `research/vendor` 保留各自许可证。旧插件原型的代码已迁移为主程序服务，运行时不安装/加载该 XPI。

## 2026-09-05 PDF 修复补充

之前的 5 组测试未验证实际 PDF 渲染，遗漏了 Windows reader ZIP 解压不完整问题。现改为完整解压官方构建包，再复制 `zotero/` 子树；每次缓存命中前检查关键 viewer、worker 和字体文件。测试资源在 `app/omni.ja` 内，更新测试必须重新构建，不能只复制到 staging 的外部 `tests/` 目录。

接口参考：
- https://api-docs.deepseek.com/
- https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html
- https://www.ncbi.nlm.nih.gov/books/NBK25499/
- https://info.arxiv.org/help/api/user-manual.html

列切换缓存修复后又执行了本地回归：7/7 通过，显式跳过已验证的网络调用，避免重复消耗服务额度。日常构建未包含测试运行器。

日常版本验收：三项凭据已进入 research-native-profile 的密码管理器，一次性配置文件已删除；模型为 deepseek-v4-flash。再次运行日常启动脚本后，Zotero 主进程仍为 1 个。最终 omni.ja 含 PDF viewer、worker、字体和服务模块，不含测试运行器。
