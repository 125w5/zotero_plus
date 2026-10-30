# Camera IoT 测试修复：PPT 与执行方案导出

核对依据为 `output/camera-iot-workflow-2026-10-27/testing/test-report.md`、`native-ppt-qa.md` 与 `native-word-qa.md`。本轮修复 UI-15、UI-16、UI-17、UI-18、UI-23 对应的导出管线；不改文库、论文原件、已写稿件或旧导出文件。

## 修复范围

| 问题 | 处理 | 保护边界 |
|---|---|---|
| PPTX 备注含 XML 1.0 非法控制字符 | 写出后检查全部 XML/关系部件，移除 PDF 字形映射中的非法控制码；保留合法 Unicode、制表和换行 | 原始来源对象与原 PDF 不变 |
| 内容类型声明引用不存在的母版 | 删除指向不存在部件的声明，并验证所有内部关系的实际目标 | 真正缺失的关系目标直接拒绝，不伪造空母版 |
| 表格截成正文 | 横线按端点分组，比较图注上下两侧的完整表格组 | 自动裁切仍标记待确认；人工裁切不自动替换 |
| 公式下缘残片、伸缩括号缺失 | 保留 CMEX 中编码为 CR/FF 的可见字形；处理相邻字体框的亚点重叠 | 原公式以图像保真，不推测或重写 LaTeX |
| 旧 PPT 草稿持续使用错误裁切 | 预览/导出前只刷新过期的自动素材，按 PDF 哈希、物理页、类型与图号匹配 | 保留素材 ID、人工说明、人工标题、人工裁切和全部页面文字；不请求模型 |
| 测量口径与硬件角色丢失 | 在原始来源中保留指标/排除项/硬件/网络的连续上下文，优先提供给页面生成；定量端到端时延漏写明确的服务端推理排除项时自动修复一次 | 不将提示词当事实；不硬编码 AccMPEG 数字或设备；不同论文的口径不混用 |
| 页脚题名无截断标记 | 按 Unicode 字符截断并添加省略号 | 引用页码链接保留 |
| 对比页四子图太小 | 两图采用更宽的并排区域；宽图与近方形多子图组合时，第二图使用完整右半页高度，正文保留在左图下方 | 不删文字，不新增页数，不改变主题颜色与字体 |
| 执行方案工时单独跨页 | 仅将动作/交付物/验收/工时四段任务设为连续排版 | 概况等长段落正常分页，未插入强制分页 |

## 验证

1. `node --test services/research-engine/test/studio.test.mjs services/research-engine/test/engine.test.mjs services/research-engine/test/weekly-research.test.mjs services/research-engine/test/image-ingestion.test.mjs`：43 项通过，包含过期素材只刷新一次、已完成图片说明复用与人工裁切保护。
2. PDF 环境执行 `python -m unittest test_assets.py`：48 项通过，包含上下图注、页眉/邻图隔离、公式控制字形和相邻正文残片。
3. Word 环境执行 `python -m unittest test_document.py`：5 项通过，包含四字段任务保持与概况正常分页。
4. 原 AccMPEG 重新提取：22 份素材，Table 1/2 与 Equation 1 已逐图核对。PDF SHA-256 为 `e6e7a49d5b2daea90deb83c5c7d858c403b1d364130be0c31b69d5fb6ba7e83f`。
5. 用原测试的 17 页计划在隔离目录重新导出：86 个 XML/关系部件有效；10 份备注中的非法字符已清理；16 条不存在母版声明已移除；LibreOffice + Poppler 渲染仍为 17 页，机械检查通过。人工查看第 9 页表格、第 12 页对比布局与裁切总览。
6. 原执行方案在隔离目录重新导出：仍为 5 页，第 6 任务标题、动作、验收与“预计 24–55 小时”同页。

隔离证据位于 `E:/workspace/zotero-main/.tools/camera-iot-export-repair-1027/`：

- `verification.json`：完整包检查、裁切映射、测量上下文与渲染报告。
- `crop-review.png`：Equation 1、Table 1、Table 2。
- `deck-wYOxGd/presentation.pptx`、`presentation.pdf`、`page-09.png`、`page-12.png`：最终布局验证。
- `word-final/render-check.json`、`word-final/hours-page.png`：任务分页验证。

## 验证边界

机械重导保留原测试计划的文字，未对旧 PPT 的科学措辞静默重写。新生成内容使用新的上下文与检查规则；硬件角色、网络条件与全部事实仍需按原文复核。局部确定性规则不能证明全部科学解释正确。未在桌面 Microsoft PowerPoint/Word 中验收；未替换用户原产物。
