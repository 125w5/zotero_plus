; SPDX-License-Identifier: AGPL-3.0-or-later
#ifndef Payload
  #error Payload is required
#endif
#ifndef Release
  #define Release "0.1.0"
#endif
[Setup]
AppId={{9F187A7E-7DB5-43D2-B6A9-B3148DF13A73}
AppName=EasySch
AppVersion={#Release}
AppPublisher=EasySch Contributors
DefaultDirName={localappdata}\Programs\EasySch
DefaultGroupName=EasySch
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#Output}
OutputBaseFilename=EasySch-{#Release}-Windows-x64-Setup
SetupIconFile={#Payload}\EasySch.ico
UninstallDisplayIcon={app}\EasySch.exe
WizardStyle=modern
Compression=lzma2/fast
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMADictionarySize=32768
DisableProgramGroupPage=yes
LicenseFile={#Payload}\LICENSE.txt
CloseApplications=yes
RestartApplications=no
Uninstallable=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: checkedonce

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\EasySch"; Filename: "{app}\EasySch.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\EasySch"; Filename: "{app}\EasySch.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\EasySch.exe"; Description: "打开 EasySch"; Flags: nowait postinstall skipifsilent

; Profiles and research assets are outside {app}. Uninstall never removes them.
