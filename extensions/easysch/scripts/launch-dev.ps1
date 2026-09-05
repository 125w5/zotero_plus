param([switch]$SmokeTest)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
if (!$SmokeTest) {
    & (Join-Path $repo 'scripts/launch-research.ps1')
    exit
}
$plugin = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = Split-Path $repo -Parent
$tools = Join-Path $workspace '.tools'
if (-not (Test-Path -LiteralPath (Join-Path $tools 'zotero/core/zotero.exe'))) {
    throw 'Run scripts/setup-tools.ps1 first to install the isolated Zotero and Pandoc runtimes.'
}
$profile = Join-Path $tools $(if ($SmokeTest) { 'easysch-test-profile' } else { 'easysch-dev-profile' })
$data = Join-Path $tools $(if ($SmokeTest) { 'easysch-test-data' } else { 'easysch-dev-data' })
$running = Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) }
if ($running) { throw "This isolated profile is already running. Close all its Zotero and EasySch windows before rebuilding: $profile" }
New-Item -ItemType Directory -Force $profile, $data, (Join-Path $profile 'extensions') | Out-Null
node (Join-Path $PSScriptRoot 'build.mjs') --dev
if ($LASTEXITCODE -ne 0) { throw 'Development extension build failed' }
$pointer = Join-Path $profile 'extensions/easysch@local.research'
if (Test-Path -LiteralPath $pointer) { Remove-Item -LiteralPath $pointer }
Copy-Item -LiteralPath (Join-Path $plugin 'dist/easysch-0.1.0-dev.xpi') -Destination (Join-Path $profile 'extensions/easysch@local.research.xpi') -Force
$jsonData = ConvertTo-Json $data -Compress
$jsonRepo = ConvertTo-Json $repo -Compress
$jsonPandoc = ConvertTo-Json (Join-Path $tools 'pandoc/pandoc-3.11/pandoc.exe') -Compress
$testLiteral = if ($SmokeTest) { 'true' } else { 'false' }
$prefs = @"
user_pref("extensions.zotero.dataDir", $jsonData);
user_pref("extensions.zotero.useDataDir", true);
user_pref("extensions.zotero.firstRun2", false);
user_pref("extensions.zotero.firstRunGuidance", false);
user_pref("extensions.zotero.automaticScraperUpdates", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.startupScanScopes", 15);
user_pref("extensions.easysch.smokeTest", $testLiteral);
user_pref("extensions.easysch.testRepo", $jsonRepo);
user_pref("extensions.easysch.pandoc", $jsonPandoc);
user_pref("extensions.logging.enabled", true);
user_pref("extensions.zotero.integration.skipInstallation", true);
user_pref("app.update.auto", false);
"@
Set-Content -LiteralPath (Join-Path $profile 'user.js') -Value $prefs -Encoding utf8NoBOM
$exe = Join-Path $tools 'zotero/core/zotero.exe'
$argsForApp = @('-no-remote', '-profile', ('"' + $profile + '"'), '-ZoteroDebugText')
Start-Process -FilePath $exe -ArgumentList $argsForApp -WindowStyle Hidden -RedirectStandardOutput (Join-Path $profile 'stdout.log') -RedirectStandardError (Join-Path $profile 'stderr.log')
Write-Output "Started isolated Zotero. Profile: $profile"
Write-Output 'Open Tools > EasySch. Existing Zotero profiles and libraries are not used.'
