# 交接说明（2026-10-30，11-01 更新）

## 取代码

```bash
git clone https://github.com/125w5/zotero_plus.git zotero-client
cd zotero-client
git checkout frontend-p0-review
git submodule update --init --recursive
npm install
```

- `reader` 子模块指向本仓库的 `easysch-reader` 分支（见 `.gitmodules`），阅读器的 EasySch 改动都在那里。其他子模块仍指向 Zotero 上游。
- 新电脑上的构建步骤见下文“在新电脑上构建”。`scripts/build-native.ps1` 不再写死旧电脑的路径：MSYS2 由 `MSYS2_ROOT` 指定（默认 `C:\msys64`），git 和 node 从 PATH 查找。
- `scripts/launch-research.ps1` 需要仓库外的 `../.tools/`（pandoc、LibreOffice、poppler、`pdf-assets-env` Python）。

## 现在的状态（11-01）

10-30 交接清单里的四项都已做完：

- 语料库复核遗留 7 项（CR-1、CR-2/WSB-08、CR-4、CR-5、WSB-09、WSB-20，CR-3 原已修好），以及修复后再查出的问题。
- 笔记本与项目 12 处修复做了对抗式复核，确认的 39 个问题全部修复。
- 跨模块修改：按钮“运行中”状态、arXiv 先下载 PDF 再写入文库、OpenAlex 只取开放获取位置的 PDF。可选的 `S.request` 实时预览没有做。
- 重新构建并在新电脑上跑原生套件，按手册核对截图。

之后又做了：

- 第二轮对抗式复核，确认 34 处问题，全部修复或按产品现有行为改写测试。
- 装配页卡顿：分页不再每放一个块就强制重排，隐藏的画布不分页（“速读细调”原来每章只剩一页），大项目打开时先画导航再画画布和对话。数字见下文“性能”。
- 按手册逐张核对原生截图，确认 72 处问题：修了 67 处；3 处是测试客户端用 en-US 语言造成的英文标签，不是问题；1 处（阶段名）需要你定；2 处要在原生客户端里看几何，没有改（见“已知但没改的”）。
- 数据丢失回归（自 01213a348）：在“论文结构”的段落行按 Delete 会删掉整章，在“来源核查”的使用位置行按 Delete 会把整份素材移出项目。现在只删该行或解除这一处关联。
- 可行性页的研究问题、条件、结构在拼音组字时不再保存（原来停顿 500 ms 就把拼音写进草稿，并让已确认的方向变成过期）。
- 素材库搜索：每次按键不再为每张章节卡重新比对全部素材、复制原文锚点，同一个词在一个字段里只扫一次；Node 基准里每次查询从 123–311 ms 降到 32–47 ms，结果、顺序、片段完全不变。另修了一个漏检：模糊模式下，只靠合并标签的别名（如 PNC）或自动生成的中文说明命中的素材，搜到后又被范围过滤去掉，列表是空的。
- 装配画布：每张素材卡不再预先建一个隐藏的页外批注收起按钮（约 300 个，只有少数会显示），改为第一次需要时再建；页脚状态栏的宽度规则不再用以 body 为锚点的 `:has()`，改为 `applyPanels` 写在 body 上的属性。
- 参考文献元数据缓存：查询版本升到 `public-reference-3`，有记录的缓存也要版本一致才复用。原来改成“只取开放获取位置的 PDF”之后没升版本，之前缓存的记录（可能带出版社的付费 PDF 地址）还会用 7 天。升级后每条参考文献在第一次查看时会重新查询一次。
- 对话读取资料时，文件夹重新扫描把新文件自动选上（例如刚拖入、刚索引完的 PDF），原来会让正在进行的回答报“读取时当前对话的资料选择已变化”。现在只比较本次正在读取的文件。这也是原生 PPT 套件“AI 优化结构”一项在全量运行里失败的原因。
- 对话资料：Zotero 重启后会复用已删除条目的 ID，对话里记住的附件 ID 可能已经属于另一篇论文，原来会悄悄把那篇论文的 PDF 当作这份资料的证据。现在提示“资料关联已失效”；再次拖入同一文件时，先删掉失效的缓存再导入。不是文件附件的条目也不再调用 `getAnnotations()`、`getFilePathAsync()`（原来会让项目恢复和打开可行性页报错）。
- 论文结构导航的标题和“速读细调”里每个段落的预览行不再显示原始 LaTeX（`$x_i^2$` 显示为 xᵢ²，`\frac{a+b}{2}` 显示为 (a+b)/2）。
- 阅读器论文概览：第二次悬停封面时浮层不出现。原因是别的面板或内嵌框架的 resize、scroll 也会取消显示计时器；现在只有触发元素所在的滚动容器、文档或本窗口自己的变化才关闭浮层。
- 界面核对的跨文件修正：文献检索结果卡片的左边对齐、翻译反馈按钮的高度、PPT 保存记录标题的内边距、窄窗口下 PPT 操作行的换行、“固定到左栏”与“固定对话”的图标、装配页发送按钮改用主按钮令牌（两种主题都可见）、证据详情浮层不再盖住标题栏。
- 组会“AI 页面与方法图规划”的“取消”原来只改界面文字，请求照常跑完并保存页面规划；现在会中止请求，不保存。“开始阅读这篇论文”运行时标 `aria-busy`（原本就会禁用）。
- 截图复核最后又补出 52 处确认问题（文库与阅读器、共享对话、研究对话页、论文装配、笔记本/检索/设置/PPT）。在当前构建的截图上逐项复核：其中 2 处是 en-US 语言标签，不算问题；其余 50 处里修了 37 处，8 处在当前构建里已经不存在，5 处只修了一部分或要改另一个文件，剩下的改动列在“已知但没改的”。

本轮的提交：910ea4385、e1712afc7、4e35f6de6、f43c3bb32、dd5597c11、efe534c86、a3ea3d3b3、fd8812613，细节见各自的提交说明。

测试：

- Node：`node --test test/node/*.test.mjs services/research-engine/test/*.test.mjs` **2371/2371 通过**（10-30 是 2012 个）。
- 原生：[`native-suites.txt`](native-suites.txt) 现在列 76 个套件（加了 `manuscript` 和性能套件 `researchInteractionPerformance`，后者要放在最后）。最终代码上 **525/535（76 个套件）**；交接时的代码（72474a0ab）在新电脑上是 431/509。未通过的见下文“原生测试里的环境问题”。

### 性能

性能套件 `researchInteractionPerformance` 用合成数据造约 45 MB 的工作区（共享素材库 1210 张卡；大项目 36 章、520 个正文块、400 份素材），测常用操作中主线程最长的一次阻塞。报告在 `<测试数据目录>/interaction-performance/report.json`。

| 操作 | 10-31 首测 | 现在 |
| --- | --- | --- |
| 打开大项目进入装配 | 2327 ms | 333 ms |
| 素材装配 → 方向讨论 | 2707 ms | 123 ms |
| 方向讨论 → 速读细调 | 591 ms | 230 ms |
| 速读细调 → 内容导出 | 1381 ms | 249 ms |
| 内容导出 → 素材装配 | 2692 ms | 245 ms |
| 素材库逐字搜索 | 293 ms | 216 ms |
| 打开首页 | 284 ms | 250 ms |

切换阶段时的同步重排从约 520 次降到 2-7 次。其余操作（输入、滚动、页面切换、打开素材详情、写盘）都在 100 ms 左右或更低。
数字是单次实测。机器上同时跑别的程序时会高出 20-30%（同一份代码的两次运行里，打开首页分别是 204 ms 和 268 ms）。

## 需要你决定的

产品取舍（都没有改，各自的修法写在后面）：

1. **可行性页草稿过期装配内容（WSB-11）**：可行性页上改研究问题、条件或范围，会写入 `researchPreparation`，让装配里已确认的方向和章节速读变成过期。两位复核者意见相反：一位认为是回归，一位认为是手册（`writing-ppt.json` 第 20 条）、代码注释和测试写明的行为。若要改：把“已采用的方案快照”和草稿分开存。
2. **联网评估的 18 篇上限（WSB-13）**：上限把已保存列表里的论文也算进去，重复评估可能一篇新的也加不进来。现在的说明是“计入本次”。
3. **方案签名是否包含 `sourceCollectionIDs`**：在保存任何论文选择之前评估的方案（旧项目、对话里评估的方案）没有这个字段，页面第一次保存选择后会显示“方案待更新”。
4. **装配页的文件详情没有入口**：右栏去掉“对话文件”页签（ef386f0fd）后，`assembly-conversation-files.mjs` 的文件详情（结构样本勾选、表格的工作表与范围）和“请先打开文件详情选择资料”提示都打不开；`writingWorkflow.sections[].referenceMaterialIDs` 只能从这里设置。删掉，还是接到对话栏的文件行上？
5. **文库论文导航里的学术对话怎么退出**：“返回”被 CSS 隐藏；Esc 现在能收起对话，但不会回到论文信息栏。
6. **阅读器里正在看的论文进不了工作台**：自 01213a348 起 `E.open()` 不再读取当前阅读器，没有入口把它带进来。

手册与代码不一致：

7. 阶段名“速读细调”是写作流程 v3 的改名，手册没改。
8. “速读细调”中间任务栏的拖动条让它比两侧 44px 的标题低 16px，测试按现状断言并标了“待产品确认”。若要对齐：给两侧卡片加 16px 上内边距。
9. 任务栏轨道：手册写 7px，代码、测试与 10-28 性能文档用 12px（有意为之）。
10. `R/ui/agent-workbench.js` 中 `#view-home` 的推荐列表自 ef386f0fd 起打不开，删掉或重新接入。
11. 同一地址下的聊天模型与学术翻译共用一个密钥（阅读器翻译只按地址取密钥）；要分开须同时改 `X/reader-results.js`。

隐私：

12. 仓库是公开的。`test/tests/researchRapidRealPaperTest.js` 和 `researchSourcePaperDataTest.js` 写死了旧电脑文库的存储路径和一篇论文的标题。

这次没问你、按推断定下的行为（不同意可以改回）：

- 模板按钮上按 Esc 只关模板列表，不中止正在运行的装配任务；再按一次 Esc 收起对话。
- 打开准备页不再保存推断出的范围；重新打开时不恢复文件夹筛选；没勾选的论文不能标为精选；项目文件夹在开始第一个任务时才建，不在打开页面时建。
- 首页卡片：采用的方案已过期、还没开始写作的项目，点卡片打开可行性页，不再自动确认。
- arXiv 和开放获取下载只记录不会恢复的失败（404/410、网页、不是 PDF、超过 80 MB）；限流、5xx、403、超时不记录，否则这一行会被隐藏 24 小时。
- 回答进行中新加入对话的资料不用于这一次回答，从下一次提问起才读取（原来是整次回答报错）。
- 素材库模糊搜索：目录检索已经命中的素材（包括只靠别名或自动生成的中文说明命中的）不再被范围过滤二次检索；研究领域、第二关键词、排除词和严格模式仍照常过滤。
- 截图里的英文标签来自测试客户端的 en-US 语言；zh-CN 的 `easysch.ftl` 键齐全，没有改。
- 文库条目列表：标题列最后才被压缩；“#标签”列默认更窄；“期刊标签”列默认隐藏（列选择器里仍可打开）。只影响没有保存过列设置的情况，已保存的列宽和显隐不变。
- 可行性页：没有方案或方案已过期时，“生成可行性方案”是主按钮；方案是最新的时，“确认方案，进入素材装配”是主按钮。同一时间只有一个主按钮。
- 收起右栏后，装配顶栏的步骤条只在标题组和导出按钮之间居中；放不下时单独占一行。
- 研究对话等嵌入页面的错误提示改为浮在页面顶部中间，不再占一行把整个页面往下推；提示上有关闭按钮，其余部分点击会穿过去。设置里的“操作权限”选项从 “Auto” 改为“直接执行”，避免和下方任务模式的“自动”同名。
- 阅读器标签页窗口窄于 860px 时，左右两组按钮保持完整，中间的批注工具在工具条内横向滚动（另一种做法是把“速读/译文”改成只显示图标）。

## 已知但没改的

- 笔记本不能选没有父条目的独立 PDF（语料库收集已经能处理它们）。
- 复制项目不复制全文评估；原项目的自动语料库在副本里可选；文库素材卡在项目之间共用；这次修复之前复制的项目仍共用 id。
- 正文里选中文字后出现的“查找相关证据 / 格式”栏放在右栏顶部（`R/manuscript/editor.mjs` 的 `showTextTools`）；右栏收起或显示别的内容时看不到它。Ctrl+Tab 仍可查找证据。放在哪里需要界面上定。
- `test/node/project-copy-catalog.test.mjs` 在一次全量运行中失败过一次（两个按时间生成的 id 相同），单独跑和重跑都通过。
- 写盘：每次 `notebook.update` 提交都会把整个约 45 MB 的工作区重新序列化（`storage.js` 的 `createWorkspaceSerializer`），Node 里每次 11–14 ms，素材库逐字搜索时约 4 次。要再降需要按分支增量写盘。
- 素材库搜索还剩的 30–50 ms 是对约 800 万字符卡片文本和 6.6 MB 论文原文的子串扫描，没有索引；要再降需要倒排索引。首次搜索约 180 ms（第一次归一化全部文本）。
- 手册重建不了：`docs/handoff-2026-10-27/build-handbook.mjs` 要读 `data/workspace.json`，但 `.gitignore` 的 `**/workspace.json`（本意是防止提交真实工作区）把它也排除了，这个文件只在旧电脑上。手册的 `source-index.json` 里的源码指纹自 10-30 起已经过期。要修：在 `.gitignore` 里为 `docs/handoff-2026-10-27/data/workspace.json` 加一条例外，再从旧电脑拷过来提交。
- 界面核对里还有两处没改，需要在原生客户端里看几何：组会 PPT 的底部托盘在窗口较矮时盖住舞台的控制按钮；装配“内容导出”阶段切换时画布会跳一下（阶段按钮应从右栏标题移到画布操作行）。
- 对话里拖入的文件：如果记住的附件 ID 被另一个同类型的文件附件占用，仍认不出来（除表格外，引用里没有存文件指纹）。
- 截图复核里还差几处小的跨文件改动（时间到了没做，原生截图也还没复核）：
  - 笔记本素材库的“中文简述 / 题目 · 分类”切换看不出当前选中哪一个：在 `R/surface.css` 第 48 行后为 `.material-view-switch button[aria-pressed=true]` 用 `--ui-selection` 底色、未选中的用透明底。“最近使用 · 最近搜索”字号 9px：加 `#recent-searches small{font-size:inherit}`。
  - 资料栏勾选框颜色：`R/shared/conversation-files.css` 第 31 行 `accent-color:var(--accent)` 改为 `var(--ui-primary-text,#405e82)`，与检索页一致。
  - 组会 PPT 的发送按钮（`R/ppt-studio.css` 第 161 行）仍是写死的渐变，应改用 `--ui-primary` / `--ui-primary-text` / `--ui-primary-hover`。
  - 新建论文对话框的关闭按钮 × 仍有旧的内联外边距（`R/workspace.html` 第 39 行）。
  - 第一次使用的“日常整理”列预设（`X/app.js:100`、`X/sidebar.js:4`）仍包含期刊标签列，只影响新建的配置。
  - 阅读器收起条闲置时透明度为 0.6（为了满足“闲置时变淡”的测试，同时保证文字对比度不低于 3:1），会透出约 40% 的页面；手册更倾向把内容调暗而不是降低玻璃面板的透明度，这个测试以后可以重新考虑。
- 截图复核的修正都只在 Node 测试和代码层面检查过，还没有在原生客户端里重新截图核对。

## 原生测试里的环境问题

这些失败不是代码问题：

- `researchRapidRealPaper`、`researchSourcePaperData`、`researchReferenceFlow`（3 项）、`researchNotebook`、`researchNotebookRestore`：需要旧电脑文库里的真实 PDF（`storage/ZT67RDCC` 等），部分还需要模型密钥。换成自己的文献，或先跳过。
- `researchWritingInteraction` 第 2 项：需要素材卡和一篇解析过、含“实验设置”的全文。

与运行顺序有关的失败（同一个 `-TestRunID` 下各套件共用一个文库，前面套件留下的条目会改变后面套件看到的数据）：

- `researchPPTWorkspace` 在全量运行里有 3-4 项时过时不过（11-01 的四次全量运行分别是 19/23、22/23、19/23、23/23，代码几乎相同）；单独运行是 **23/23**。失败截图里“本次资料”多了别的套件留下的文件，论文行的初始勾选状态也不同，测试按位置点第二行，点到的就不是预期的那一项。要稳定，可以让这个套件使用自己的 `-TestRunID`，或让测试按文件名而不是位置找行。
- `researchReferencePane` 第 3 项在全量运行里偶尔失败（单独运行 8/8）：测试取文库里的第一个条目，取到没有字段的条目时 `dd` 不存在。
- 最终运行中 `researchPreparationFlow` 第 15 项（等待装配检索词保存超时）和 `researchReaderNavigation` 第 6 项（缩略图列表里多了一张别的套件缓存的图）失败；同一个构建单独运行分别是 21/21 和 6/6，之前三次全量运行也都通过。

## 在新电脑上构建（Windows，11-01 实测）

需要的工具：Git、Node（实测 24.22）、PowerShell 7、MSYS2（`pacman -S zip unzip rsync python p7zip`）。`launch-research.ps1` 另需仓库同级的 `.tools/`：pandoc、LibreOffice、poppler、`pdf-assets-env` Python。GitHub 和 npm 下载如需代理，给 git 和 npm 都配上。

1. 克隆后先 `npm install`，再检查 `resource/ace` 和 `resource/csl-validator-wasm`：它们是指向 `node_modules` 的目录链接。如果克隆时 `node_modules` 还不存在，Windows 上的 git 会建成文件链接，构建时报 EPERM。删掉后在 cmd 里重建：

   ```bat
   mklink /D resource\ace ..\node_modules\ace-builds\src\
   mklink /D resource\csl-validator-wasm ..\node_modules\csl-validator-wasm
   ```

2. 子模块初始化如果被打断，`chrome/content/zotero/xpcom/utilities` 和 `resource/schema/global` 可能是空目录，再跑一次 `git submodule update --init --recursive`。
3. 在 `reader/` 和 `note-editor/` 里各跑一次 `npm install`：`build-native.ps1` 直接用它们的 webpack 打包。
4. 阅读器：Zotero 的 CI 包存储里没有 EasySch 阅读器提交的预构建包。`js-build/reader.js` 会在 `tmp/builds/reader/` 里找 pdf.js 子模块相同的祖先提交的包，并用本地打包的 `reader.js` 覆盖。把上游提交 `1f3263034b4cfc4e1aa324f88126a933b6f1f595` 的包放进去：

   ```bash
   curl -fL https://zotero-download.s3.amazonaws.com/ci/reader/1f3263034b4cfc4e1aa324f88126a933b6f1f595.zip -o tmp/builds/reader/1f3263034b4cfc4e1aa324f88126a933b6f1f595.zip
   ```

   然后在 MSYS2 bash 里、`reader/` 目录下构建一次 pdf.js：`PDFJS_CONFIG=zotero bash pdfjs/build`。`npm run build:zotero` 在 Windows cmd 里不能用（`PDFJS_CONFIG=...` 是 bash 写法）。
5. Firefox ESR：`app/scripts/fetch_xulrunner` 用 MSYS2 的 curl 下载，经代理时 TLS 可能断开。可以先用 Windows 自带的 curl 把 `Firefox Setup <版本>-win-x64.exe` 和 `Firefox <版本>-win-x64 Components.zip` 下到 `app/xulrunner/`，脚本会直接用。
6. 构建：`$env:MSYS2_ROOT='<MSYS2 目录>'; pwsh scripts/build-native.ps1 -Test -Incremental`（第一次不加 `-Incremental`）。

跑原生测试：`pwsh scripts/launch-research.ps1 -Test -Suite <逗号分隔的套件名> -TestRunID <名字>`。同一时间只能开一个 Zotero。结果在 `../.tools/research-native-test-profile-<名字>/stdout.log`（找 `N/M tests passed`）。性能套件会往该测试数据目录写约 45 MB 的合成数据，结束时清理，所以放在最后跑，或用单独的 `-TestRunID`。150% 缩放的屏幕上用默认设置即可通过。

## 10-30 那次提交包含什么

10-28 至 10-30 的工作，详细说明见 [`../freeze-and-research-flow-repair-2026-10-29.md`](../freeze-and-research-flow-repair-2026-10-29.md)：卡死修复（存储只读视图、按条目缓存的写盘、去掉热路径上的整库复制）、界面统一、AI 回答流式显示与引用核对、文献检索改进、写作流程 v3（设计见 [`writing-flow-v3-spec.md`](writing-flow-v3-spec.md)）、按手册审计的 97 处缺口。

## 工作约定（之前的会话里定下的）

- `docs/handoff-2026-10-27/` 的手册是界面风格和行为规范：功能改动按手册做，保持现有样式，不新增颜色。
- 装配生成的是详尽的章节速读和可选的任务计划，不生成论文正文。
- 性能和架构可以自由调整。
- `workspace.json` 约 45 MB：读路径用 `E.store.peek` 和各个只读视图，不要用无路径的 `E.store.get()`。
- 代码风格见 `CLAUDE.md`；用户可见文字是自然的中文，沿用各文件的写法。
