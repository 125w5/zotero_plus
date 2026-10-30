# Camera IoT 测试修复：素材与装配衔接

本记录对应 `output/camera-iot-workflow-2026-10-27/testing/test-report.md` 的 UI-02、UI-11、UI-13、UI-14、UI-19、UI-21、UI-22。仅记录本次源码修复与受控回归；原生安装和真实界面结果由主验收记录补充。

| 测试问题 | 修复后的行为 | 验证 |
| --- | --- | --- |
| UI-02 顶部刷新未刷新候选快照 | 项目刷新会等待文献准备区重读本地文库；重读保留未保存的勾选增减，下载后的刷新复用同一路径 | 真实 browser/preparation 模块的 DOM fixture 在导入新论文后点击顶部刷新，验证新候选可见及旧排除保留 |
| UI-11 Camera IoT 混入只匹配 Camera 的论文 | 显式查询独立于方案提示词；普通英文多词查询要求各词共同命中，分号保留备选词组，完整跨语言别名继续有效 | Camera-only 的 3DGS 摘要不再进入 Camera IoT 结果；remote sensing 仍可找到中文遥感论文 |
| UI-13 准备286份但装配默认无结果 | 应用准备素材时重置浏览筛选，默认显示项目素材；研究领域和可行性约束保留。全部素材或清空可返回全库，空结果提供本地恢复入口 | 286份完整素材接续，排除另504份全库资料；清空后790份可见，正文、素材原文和方案约束保留 |
| UI-14 缺指标年份仍显示普通数值 IF | 缺年份主标签为“IF 待核验（年份未标明）”；来源报告值和来源保留在详细信息/悬停中 | IF 8、8.4 缺年份显示待核验；有年份正常显示；投稿期刊身份保留 |
| UI-19 固定可行性遮住导出控件 | 内容导出阶段让出方案栏，返回前面阶段恢复用户固定偏好 | 阶段切换后导出控件可用，偏好未删除 |
| UI-21 首页模块数陈旧 | 编辑器保存后标记首页待刷新，回到首页时更新；隐藏首页、正在输入搜索或打开创建对话框时避免重建 | 0→5→6模块计数刷新，输入焦点和创建对话框受保护，离开时取消订阅 |
| UI-22 实质段落数量无对应 | 输入增加程序统计清单；评估必须逐一标明已成文模块的判断与真实ID，UI可定位对应模块，执行方案带同一清单。空素材占位由程序计数 | 5个非空模块/其中4个有实质内容分别说明；遗漏和重复ID拒绝；286空占位不要求模型重复输出，不生成286条空白说明 |

## 范围与兼容

- 保留现有页面框架和资料数据，新增恢复入口沿用 `quiet-action` 等现有控件样式；没有创建一套新视觉主题。
- 浏览筛选与研究约束分离：清空素材浏览不会修改可行性方案、正文、批注或研究领域。
- 全文评估格式升级为第2版；第1版评估仍保留在存储中，需要重新评估后才能作为当前版本导出，避免继续使用缺少数量对应清单的评估。
- 稿件清单的“有内容”指正文、表格或图片存在，不等于研究完成；是否有实质内容属于逐模块的模型判断，二者分别展示。

## 定向回归

105项 Node 回归全部通过（12个测试文件），另对已修改原生测试脚本执行语法检查。

```powershell
node --test test/node/preparation-sources.test.mjs test/node/material-research-polish.test.mjs test/node/notebook-preparation-flow.test.mjs test/node/notebook-material-selection.test.mjs test/node/notebook-assembly-resume.test.mjs test/node/manuscript-assessment.test.mjs test/node/assembly-workflow.test.mjs test/node/assembly-continuity.test.mjs test/node/camera-iot-assembly-surface.test.mjs test/node/journal-metric-label.test.mjs test/node/writing-workflow-integration.test.mjs test/node/material-list-position.test.mjs
```

这些测试使用真实模块和受控数据/模型响应验证接续、筛选、并发更新与保护条件，不等同于真实模型质量或原生截图验收。

## 首轮原生回归后的补修

原生准备页接续暴露了本次 catalog 回写的局部状态缺陷：已有 `ui.catalog` 对象但没有 `selection` 时，素材列表访问 `selection.includes` 导致装配初始化终止。已增加共享 `materialCatalogState`，补齐缺失默认值并保留既有范围、筛选和有效选择；准备页、装配页及接续回写使用同一函数。定向回归包含“局部 catalog 无 selection”及286份素材交接情形。

原生工作流测试也已更新到当前四阶段“素材装配—方向讨论—初稿细调—内容导出”。公式测试改走实际“文字工具—插入—公式”，再打开“详情与来源”，不再查询已经移除的旧插入页控件。产品流程未回退。
