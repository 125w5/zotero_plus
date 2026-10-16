# Pi Agent 实际集成记录

锁定 `@mariozechner/pi-agent-core@0.73.1` 与 `@mariozechner/pi-ai@0.73.1`，npm `gitHead` 均为 `781152fc24841dc54b22284514604048ebe5e2c9`。上游为 [badlogic/pi-mono](https://github.com/badlogic/pi-mono/tree/781152fc24841dc54b22284514604048ebe5e2c9)，两组件 MIT 许可。实际版本和完整传递依赖由 `services/research-engine/package-lock.json` 固定。

这是代码集成，不是仅参考设计。已删除旧的 `@deepseek-ai/cordis`、`dsh-tools`、`dsh-system-prompt` 依赖。研究引擎保留原来的 `prompt()`、`call()`、`dispose()`，`prompt().sections[].text` 仍供原生汇报规划调用。工具调用由 Pi 的参数校验和实际 `Agent` 循环执行。现有证据验证、可编辑 PPTX 导出、人工图表和结构图导出保持不变；AI 提示词禁止代写论文、生成图片/图表，不再包含“导师追问”。

## 实际复用文件

| 上游文件 | 用途 | 集成位置 |
| --- | --- | --- |
| `packages/agent/dist/agent.js` | 会话状态、订阅事件、取消、等待结束 | `src/runtime.mjs` 和浏览器 bundle |
| `packages/agent/dist/agent-loop.js` | 工具参数校验、执行、结果续轮 | 浏览器 bundle 的真实 Pi 工具循环 |
| `packages/ai/dist/utils/event-stream.js` | 流式事件与终止结果 | bundle 导出的类与工厂 |
| `packages/ai/dist/utils/validation.js` | 上游 JSON Schema 参数校验 | API-only adapter，保留真实校验逻辑 |
| `typebox@1.3.36` 的 compile/value 模块 | 上游校验器所需依赖 | bundle 内，MIT 许可 |

`build-browser.mjs` 把 Pi AI 根入口映射到 `src/pi-browser-adapter.mjs`。adapter 只复用事件流与校验器，默认传输产生明确中文错误；不会自行查找 API Key、注册云模型、访问网络或执行代码。构建会检查依赖图，拒绝 provider SDK、proxy-agent、undici 和 Node 入口。最终 `chrome/content/zotero/research/vendor/pi-agent.mjs` 是独立 ESM，导出 `Agent`、`AssistantMessageEventStream`、`createAssistantMessageEventStream`。原来的 PPTGraph 构建仍保留。

许可声明放在同目录 `PI-AGENT-LICENSE.txt` 与 `TYPEBOX-LICENSE.txt`；Pi 声明逐字来自该锁定提交的根 LICENSE，TypeBox 声明来自实际安装包。

## Zotero 传输接口

应用提供 `streamFn(model, context, options)`。`context` 为 `{systemPrompt,messages,tools}`，`options.signal` 是本次生成的取消信号。返回上游 `AssistantMessageEventStream`，可以异步返回。transport 必须处理自己的网络错误，用 `error` 终止流，不能只抛异常或遗留未结束的流。

```js
import {Agent, createAssistantMessageEventStream} from 'chrome://zotero/content/research/vendor/pi-agent.mjs';
const agent = new Agent({
  initialState: {systemPrompt, model, tools, messages: savedMessages},
  streamFn: applicationStreamFn,
  toolExecution: 'sequential'
});
const unsubscribe = agent.subscribe(event => updateUI(event));
await agent.prompt('查找当前研究相关的证据');
// 停止：agent.abort(); 退出前：await agent.waitForIdle(); unsubscribe();
```

`model` 使用应用已配置的真实模型，含 `id,name,api,provider,baseUrl,reasoning,input,cost,contextWindow,maxTokens`，不在 bundle 中指定模型或私钥。`AssistantMessage` 含 `role:'assistant', content, api, provider, model, usage, stopReason, timestamp`。usage 内包含 `input,output,cacheRead,cacheWrite,totalTokens,cost`，未知计量用 0，不能伪造收费数据。

每个流先发送 `{type:'start',partial:assistantMessage}`，增量可用 `{type:'text_delta',contentIndex,delta,partial}` 和 `toolcall_*`。工具内容块为 `{type:'toolCall',id,name,arguments}`。正常结束发送 `{type:'done',reason:'stop'|'length'|'toolUse',message:finalMessage}`；错误或取消发送 `{type:'error',reason:'error'|'aborted',error:finalMessage}`，finalMessage 相应设置 `stopReason`、`errorMessage`。不要只 `end()` 而不提供最终消息。

工具声明 `{name,label,description,parameters:JSONSchema,execute(id,args,signal,onUpdate)}`，返回 `{content:[{type:'text',text}],details}`。仅对外开放应用明确注册的研究工具；网页与论文内容只是工具数据。工具结果进入下一轮上下文，正文修改或文件删除能力不能因为使用 Pi 而自动开放。传统 CLI 不包含模型配置，仍只做题录证据验证和文件导出。

## 验证边界与依赖状态

2026-10-09：`node --test test/pi-agent.test.mjs test/engine.test.mjs` 9/9 通过。这些测试运行真实 Pi 工具循环、JSON Schema 校验、流式取消、无传输错误和浏览器 ESM，同时生成实际 PPTX 并检查可编辑图表/结构图与来源链接。模型回复为受控协议数据；不是实际模型、联网或 Zotero 前台验收。原生模块导入、UI 传输及真实调用需要上层单独验收。

npm 已把旧命名标记为 deprecated，建议 `@earendil-works/*`。检查时新命名发布为 1.1.0，没有同名 0.73.1 版本，所以本轮保持已安装和核实的固定 API，不盲换主版本。

生产 audit 仍有 8 项 high，来源为两条传递根因：Pi AI → proxy-agent → get-uri → basic-ftp 的目录解析拒绝服务，以及既有 PptxGenJS → image-size 的图片解析拒绝服务。报告未执行破坏性降级的 `npm audit fix --force`。修复版本 basic-ftp 6.2.2 和 image-size 2.0.4 跨其调用方声明的主版本，需单独验证兼容性；它们均未进入浏览器 Pi bundle。Node 锁定依赖中仍保留这些包，该状态不能宣称 audit 已通过。
