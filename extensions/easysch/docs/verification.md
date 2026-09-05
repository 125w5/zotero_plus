# 验证记录

验证日期：2026-09-05。上游提交：`fc17dcd24ad34686cb24e6b3ffb06a6a7a5e0e5d`。

## 仓库与开发环境

- 按用户指定的 `git lfs install`、`git clone --recursive https://github.com/zotero/zotero.git zotero-client`、`git lfs pull` 获取独立完整仓库。
- 23 个子模块及嵌套子模块已检出，额外执行每个子模块的 `git lfs pull`。
- `git lfs fsck` 通过；上游已跟踪文件无修改。新增功能集中在 `extensions/easysch`。
- Git 全局 HTTP/HTTPS 代理均为 `http://127.0.0.1:7897`。
- Node 24.20.0、Git 2.55.0、Git LFS 3.7.1；已完成上游 `npm ci`。
- 补充 MSYS2 的 zip、unzip、rsync、Python 及对应运行库。
- 已安装项目隔离运行时：Zotero 7.0.32、Pandoc 3.11。未切换个人默认 Zotero 配置或同步账号。

## 构建

官方 `js-build/build.js` 在 Windows 符号链接适配脚本下成功完成：425 个 JS 文件、21 个 Sass 文件、3 个 Browserify 入口、阅读器、文档处理器和笔记编辑器均通过。构建完成后 Git 恢复临时解析的上游链接占位文件，工作区保持干净。

XPI 可重复打包，附 SHA-256。生产包包含所需脚本、CSS、字体和第三方许可证，不包含集成测试脚本。

## 测试覆盖

12 项 Node 测试覆盖接口地址约束、证据引用、翻译追问、JSON 记忆隔离、并发写入和失败恢复、图关系、公式/引用检查、日期、Pandoc 参数、HTML 转义、HTTP 错误、取消和真实 XPI 资源完整性。

Zotero 7.0.32 的隔离实例验证：真实条目和 PDF 附件、PDF 文字提取、原生子笔记、凭据按接口隔离、工作台窗口、草稿和任务、Markdown 清理与可见公式、DOCX/LaTeX/PPTX 转换、窗口截图及菜单卸载/重装。

DOCX 结构检查发现 Word 原生 `m:oMath` 公式及格式化引文；PPTX 包中生成了独立幻灯片。界面截图经过人工查看。

## 尚未验证的范围

未配置外部模型密钥，真实模型的回答质量、额度和供应商差异未验证；AI 传输及错误处理通过受控测试验证。未宣称所有版本的 Better Notes、Better BibTeX、PDF Translate 已联合安装测试。未编译打包 Zotero 11 的 Gecko 原生 Windows 整机，生产扩展暂限定 Zotero 7.0.x。

格式检查不能代替期刊投稿核查；现有 Word 动态引文域没有被转换为动态 EasySch 引用。不同期刊的图片、页边距、参考文献、匿名稿和补充材料仍需按官方要求核验。
