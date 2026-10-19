# Microsoft Visual C++ runtime license provenance

`Microsoft-Visual-C-Runtime.rtf` is the original, unmodified English
`license.rtf` embedded in Microsoft's signed Visual C++ 2015–2022 x64
redistributable, version 14.44.35211.0. The license applies to this runtime
family and its updates. It does not change the license of EasySch or of the
open source components that use the runtime.

- Official download: https://aka.ms/vs/17/release/vc_redist.x64.exe
- Microsoft deployment documentation: https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files
- Retrieved: 2026-10-19
- Authenticode: valid, Microsoft Corporation
- Download SHA256: `CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B`
- License SHA256: `8099DC3CF9502C335DA829E5C755948A12E3E6DE490EB492A99DEB673D883D8B`

The WiX bootstrapper manifest identifies embedded payload `u4` as
`license.rtf` (9,235 bytes). Only that original license was extracted; the
redistributable installer was not installed or added to the application.
The runtime DLLs distributed with EasySch come from its bundled Poppler
Windows dependency set and are deployed beside the programs that need them.
