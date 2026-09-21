param([switch]$Test, [switch]$LiveServices, [switch]$LivePPT, [string]$PDF, [string]$Suite = 'researchWorkstation', [string]$Grep)
if ($PDF) { $PDF = [IO.Path]::GetFullPath($PDF) }
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsDir = Join-Path (Split-Path $repo -Parent) '.tools'
$profile = Join-Path $toolsDir $(if ($Test) { 'research-native-test-profile' } else { 'research-native-profile' })
$dataDir = Join-Path $toolsDir $(if ($Test) { 'research-native-test-data' } else { 'research-native-data' })
$exe = Join-Path $repo 'app/staging/Zotero_win-x64/zotero.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Build the native client first.' }
$running = @(Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '-contentproc' })
if ($running.Count) {
    if ($Test) { throw 'Close Zotero before starting the isolated tests.' }
    $target = $running | Where-Object { $_.CommandLine.Contains($profile) } | Select-Object -First 1
    if (!$target) { throw 'A different Zotero profile is running. Close it before opening the daily library; the test library will not be substituted.' }
    Write-Output 'The daily Zotero profile is already running; reuse its existing window. No second application was started.'
    exit 0
}
New-Item -ItemType Directory -Force $profile, $dataDir | Out-Null
$dataJSON = ConvertTo-Json $dataDir -Compress
$pandocJSON = ConvertTo-Json (Join-Path $toolsDir 'pandoc/pandoc-3.11/pandoc.exe') -Compress
$engineNodeJSON = ConvertTo-Json (Get-Command node -ErrorAction Stop).Source -Compress
$engineEntryJSON = ConvertTo-Json (Join-Path $repo 'services/research-engine/src/cli.mjs') -Compress
$sofficeJSON = ConvertTo-Json (Join-Path $toolsDir 'libreoffice/program/soffice.exe') -Compress
$popplerJSON = ConvertTo-Json (Join-Path $toolsDir 'poppler/Library/bin') -Compress
$assetPythonJSON = ConvertTo-Json (Join-Path $toolsDir 'pdf-assets-env/Scripts/python.exe') -Compress
$prefs = @"
user_pref("extensions.zotero.dataDir", $dataJSON);
user_pref("extensions.zotero.useDataDir", true);
user_pref("extensions.easysch.testProfile", $($Test.IsPresent.ToString().ToLowerInvariant()));
user_pref("extensions.zotero.firstRun2", false);
user_pref("extensions.zotero.firstRunGuidance", false);
user_pref("extensions.zotero.automaticScraperUpdates", false);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("extensions.easysch.pandoc", $pandocJSON);
user_pref("extensions.easysch.engineNode", $engineNodeJSON);
user_pref("extensions.easysch.engineEntry", $engineEntryJSON);
user_pref("extensions.easysch.soffice", $sofficeJSON);
user_pref("extensions.easysch.poppler", $popplerJSON);
user_pref("extensions.easysch.assetPython", $assetPythonJSON);
user_pref("app.update.auto", false);
user_pref("extensions.zotero.httpServer.port", 23126);
"@
if ($Test) {
    $prefs += "`nuser_pref(`"extensions.easysch.livePPTTest`", $($LivePPT.IsPresent.ToString().ToLowerInvariant()));`n"
    $prefs += "`nuser_pref(`"extensions.easysch.liveProviderTest`", $($LiveServices.IsPresent.ToString().ToLowerInvariant()));`n"
    $prefs += "user_pref(`"extensions.easysch.testPDF`", $(ConvertTo-Json $PDF -Compress));`n"
    $prefs += @'

user_pref("extensions.zotero.integration.skipInstallation", true);
user_pref("extensions.zoteroWinWordIntegration.skipInstallation", true);
user_pref("extensions.zoteroOpenOfficeIntegration.skipInstallation", true);
'@
}
Set-Content -LiteralPath (Join-Path $profile 'user.js') -Value $prefs -Encoding utf8NoBOM
$argsForApp = @('-no-remote', '-purgecaches', '-profile', ('"' + $profile + '"'))
if ($Test) { $argsForApp += @('-ZoteroDebugText', '-ZoteroTest', '-test', $Suite, '-ZoteroAutomatedTest', '-ZoteroTestTimeout', '60000') }
if ($Test -and $Grep) { $argsForApp += @('-grep', ('"' + $Grep.Replace('"', '') + '"')) }
Start-Process -FilePath $exe -ArgumentList $argsForApp -WindowStyle Hidden -RedirectStandardOutput (Join-Path $profile 'stdout.log') -RedirectStandardError (Join-Path $profile 'stderr.log')
Write-Output "Native source client started. Profile: $profile"
