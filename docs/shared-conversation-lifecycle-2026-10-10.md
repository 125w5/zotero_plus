# 共享研究对话生命周期验收

本轮保持原论文、人工素材说明、旧对话及附件。没有提交或推送。以下为代码与受控测试结果，未代替真实模型或前台操作验收。

## 行为

- 阅读器学术对话与悬浮 Logo 按同一论文 scope 订阅同一 transcript。工作台默认跟随活动共享会话，装配按项目 scope 读取；显式选择已有会话可跨入口继承。
- 打开或新建空对话只保留内存草稿，历史菜单不列出。修改输入、模型、推理强度以及关联附件不会持久创建会话；首次实际新增的用户消息才入库。
- 不同论文默认不同 scope。选择旧会话的 scope 映射会保存；重开论文不会覆盖它。继承复制上下文形成的草稿，也要等用户真正继续提问才入库。
- `open` 的 scope 查找和创建在同一串行队列中执行。两个入口同时打开同一论文会使用同一草稿；追加消息与附件在队列内合并，不用旧页面快照替换新消息。
- 学术侧栏挂载用 `activate:false`，避免隐藏/迟到的 pane 抢走工作台当前会话。用户真正发送后才将该共享会话设为活动会话。
- 学术对话直接使用 Pi 研究任务。旧 `askPaper` 调用适配同一真实共享回答的旧结果形状，不再额外调用模型或保存隔离 transcript。
- 旧论文对话保留为一次性迁移来源和研究决策记录；迁移不覆盖已经选择的会话或继承草稿。
- 模型上下文包含最近 12 条讨论与最多 6 条相关较早讨论；完整历史仍在共享存储。公式解释要求读取原公式及邻近变量定义，保留 LaTeX 上下标，禁止从损坏文字猜测数学符号。

## 受控检查

运行：`node --test services/research-engine/test/academic-shared-conversation.test.mjs services/research-engine/test/conversation-store.test.mjs services/research-engine/test/agent-workbench.test.mjs services/research-engine/test/chat-attachments.test.mjs services/research-engine/test/pi-chat-transport.test.mjs`

47 / 47 通过。覆盖双入口首次打开并发、首次用户提交、跨入口消息合并、附件保留、源文件指纹去重、继承恢复、后台迁移不覆盖、长对话检索、真实 Pi 包的受控 SSE 与停止行为。论文和素材原数据不改写。

`researchSurfaceTest.js` 的真实学术对话断言已从旧 `paperConversations.turns` 改为共享 `messages`。本轮未运行该联网测试。

## 验收边界

本轮未进行真实模型请求、前台鼠标验证或完整应用重启验收。`snapshot()` 返回供当前界面使用的内存草稿，不等于已持久创建历史；只有 `list()` 的默认结果和存储中的已开始会话才属于历史。

既有已保存的空会话和旧未发送文本为历史用户数据，本轮不自动删除。共享回答的 `sources` 当前包含实际读取的来源；只呈现“判断依据”时应优先匹配回答中的来源引用，不能把操作状态或思考事件当作证据。
