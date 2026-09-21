# 内置组件、许可证与源码

EasySch 的新增源码标注 AGPL-3.0-or-later；Zotero 源码及其原有许可证声明保持原样。发行时同时提供与当前工作树匹配的源码压缩包，`scripts/distribution` 包含构建脚本。私人 API 配置不属于公开源码。

| 组件 | 用途 | 许可和来源 |
| --- | --- | --- |
| Zotero / Mozilla Gecko | 主程序、文库、PDF 阅读器 | 根目录 LICENSE.txt；原组件保留 MPL/GPL/LGPL 声明；https://github.com/zotero/zotero 和 https://hg.mozilla.org/mozilla-central/ |
| Node.js 24 | 运行文档生成工具 | runtime/node/LICENSE.txt；https://github.com/nodejs/node/tree/v24.x |
| CPython 3.12 | PDF、实验表格、DOCX 处理 | runtime/python/LICENSE.txt；https://github.com/python/cpython/tree/3.12 |
| PyMuPDF 1.27.2.2 | PDF 文本、位置、图像 | site-packages 中原始许可（AGPL）；https://github.com/pymupdf/PyMuPDF |
| python-docx / openpyxl / lxml | 可编辑 Word、实验数据 | site-packages 中各发行版许可；https://github.com/python-openxml/python-docx 、https://foss.heptapod.net/openpyxl/openpyxl 、https://github.com/lxml/lxml |
| Pandoc 3.11 | 文档与公式转换 | runtime/pandoc/COPYRIGHT.txt 与 COPYING.rtf；https://github.com/jgm/pandoc/tree/3.11 |
| LibreOffice | DOCX/PPTX 预览转换 | runtime/libreoffice/LICENSE.html、license.txt、NOTICE；https://git.libreoffice.org/core |
| Poppler | PDF 页面渲染 | runtime/poppler 附带声明（GPL）；https://gitlab.freedesktop.org/poppler/poppler |
| 研究引擎 npm 依赖 | PPTX、结构图、文档解析 | runtime/research-engine/package-lock.json 锁定版本，各 node_modules 保留许可证 |

不附带 Microsoft Office、不附带模型权重。参考项目原有版权、许可和引用声明位于客户端源码的 `docs/references` 与 `chrome/content/zotero/research/third-party`。

Inno Setup 仅用于生成安装程序，遵循其许可证，安装包不会要求用户另行安装编译器。https://github.com/jrsoftware/issrc
