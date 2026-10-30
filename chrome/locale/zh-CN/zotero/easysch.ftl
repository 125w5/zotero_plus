easysch-open =
    .label = EasySch 简单研究
easysch-subtitle = 简单研究
easysch-research = 文献研究
easysch-graph = 知识网络
easysch-writing = 论文写作
easysch-schedule = 研究日程
easysch-settings = 模型与期刊设置
easysch-refresh = 读取 Zotero 选中文献
easysch-tag-create-study-set =
    .label = 从标签创建动态研究集
easysch-open-docx =
    .label = 在 Zotero 中打开 DOCX

easysch-section =
    .label = 学术对话
easysch-sidenav =
    .tooltiptext = 学术对话
easysch-paper-overview =
    .label = 首页预览
    .tooltiptext = PDF 首页与图片证据
easysch-image-evidence =
    .label = 图片证据
    .tooltiptext = 原图、中文解读与来源
easysch-paper-references =
    .label = 本文参考文献
    .tooltiptext = 本文引用的论文（含未匹配条目）

easysch-material-filter-reset = 清空
    .title = 清空搜索与全部筛选，保留素材和已选内容
    .aria-label = 清空当前搜索与全部筛选
easysch-material-filter-reset-done = 已清空搜索与筛选，素材和已选内容保留

easysch-workspace-loading-title =
    { $mode ->
        [agent] 正在打开研究对话
        [search] 正在打开文献检索
        [discovery] 正在打开文献检索
        [writing] 正在打开论文装配
        [ppt] 正在打开组会 PPT
        [notebook] 正在打开论文项目
       *[other] 正在打开工作区
    }
easysch-workspace-loading-detail =
    { $phase ->
        [sources] 正在读取本次资料与对话
       *[opening] 正在准备界面
    }
clui-reveal-conversation = 展开研究对话
clui-hide-conversation =
    .title = 收起研究对话
    .aria-label = 收起研究对话

prompt-action-group =
    .aria-label = AI 研究操作
prompt-action-edit = 编辑模板
prompt-action-hint = 点击执行 · Esc 收起
prompt-action-running = 正在执行“{ $name }”…
prompt-action-complete = 操作完成，结果已显示。
prompt-action-unavailable = 此处暂不能执行研究操作，请使用当前页面的运行按钮。
prompt-action-missing-goal = 请先填写研究问题，或选择一份资料。
prompt-action-missing-source = 先选择要解释的资料或文字，再执行解释。
prompt-action-busy = 当前研究任务尚未结束，请等待或停止。
prompt-action-composer-ready = 研究对话尚未准备好，请稍后重试。
prompt-action-no-result = 本次操作未返回结果，请重试。

notebook-continue-review = 继续装配，方案待更新
notebook-plan-review-notice = 研究条件或来源已改变。可以继续已有装配；更新评估后才能应用这一版方案。
notebook-empty-feasibility-title = 可行性 · 尚未评估
notebook-empty-feasibility-detail = 补充研究问题、文献范围与资源条件，再生成可行性方案。
notebook-empty-novelty-title = 创新点 · 尚未评估
notebook-empty-novelty-detail = 生成方案后，在这里比较接近工作、差异与依据。
notebook-empty-suggestions-title = 建议 · 尚未生成
notebook-empty-suggestions-detail = 生成方案后，在这里查看验证步骤、实验安排与章节任务。
notebook-empty-history-title = 讨论与修改 · 暂无记录
notebook-empty-history-detail = 研究问题的讨论、方案版本与确认决定会保存在这里。

project-plan-needs-review = 方案待更新
discovery-field-domain = 研究领域
discovery-field-primary = 第一关键词
discovery-field-secondary = 第二关键词
discovery-refinement-toggle = 缩写与排除词
discovery-refinement-label = 缩写完整含义
discovery-refinement-input =
    .aria-label = 缩写完整含义
    .placeholder = 例如：CNN = 卷积神经网络

conversation-session-name =
    .aria-label = 对话名称
conversation-session-save-name = 保存
conversation-session-cancel-name = 取消
conversation-session-open = 打开对话
conversation-session-rename = 重命名
conversation-session-remove = 删除对话
discovery-journal-search = 搜索期刊
discovery-journal-query =
    .placeholder = 期刊名称或 ISSN
    .aria-label = 期刊名称或 ISSN
discovery-journal-verify = 核验所选期刊指标
discovery-year-from =
    .placeholder = 起始年份
    .aria-label = 发表起始年份
discovery-year-to =
    .placeholder = 结束年份
    .aria-label = 发表结束年份
discovery-year-apply = 应用年份
discovery-excluded-label = 排除关键词
discovery-excluded-input =
    .placeholder = 多个词用分号分隔
    .aria-label = 排除关键词
