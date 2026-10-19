param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$')][string]$Release = ('0.1.0-preview.' + (Get-Date -Format yyyyMMdd)),
    [string]$CredentialFile,
    [switch]$StageOnly,
    [switch]$IncludeTests,
    [string]$Payload,
    [string]$ToolsDirectory,
    [string]$PythonHome,
    [string]$Node,
    [switch]$SkipRuntimeCheck
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsDir = if ($ToolsDirectory) { [IO.Path]::GetFullPath($ToolsDirectory) } else { Join-Path (Split-Path $repo -Parent) '.tools' }
if (!$PythonHome) {
    $venvConfig = Join-Path $toolsDir 'pdf-assets-env/pyvenv.cfg'
    if (Test-Path -LiteralPath $venvConfig) {
        $pythonHomeLine = Get-Content -LiteralPath $venvConfig | Where-Object { $_ -match '^home\s*=\s*(.+)$' } | Select-Object -First 1
        if ($pythonHomeLine -match '^home\s*=\s*(.+)$') { $PythonHome = $Matches[1].Trim() }
    }
}
if (!$PythonHome -or !(Test-Path -LiteralPath (Join-Path $PythonHome 'python.exe'))) { throw 'Pass -PythonHome with a standalone CPython directory matching pdf-assets-env.' }
if (!$Node) { $Node = (Get-Command node -ErrorAction Stop).Source }
$flavor = if ($CredentialFile) { 'Preconfigured' } else { 'Standard' }
$packageName = 'EasySch-' + $Release + '-Windows-x64' + $(if ($CredentialFile) { '-Preconfigured' } else { '' })
if (!$Payload) { $Payload = Join-Path $repo ('dist/' + $packageName) }
$Payload = [IO.Path]::GetFullPath($Payload)
$argsForStage = @((Join-Path $PSScriptRoot 'distribution/stage.py'), '--repo', $repo, '--tools', $toolsDir,
    '--output', $Payload, '--node', ([IO.Path]::GetFullPath($Node)), '--python-home', ([IO.Path]::GetFullPath($PythonHome)), '--release', $Release)
if ($CredentialFile) { $argsForStage += @('--credentials', [IO.Path]::GetFullPath($CredentialFile)) }
if ($IncludeTests) { $argsForStage += '--include-tests' }
& (Join-Path $PythonHome 'python.exe') @argsForStage
if ($LASTEXITCODE -ne 0) { throw 'Payload staging failed.' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll ('/win32icon:' + (Join-Path $Payload 'EasySch.ico')) ('/out:' + (Join-Path $Payload 'EasySch.exe')) (Join-Path $PSScriptRoot 'distribution/launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
if (!$SkipRuntimeCheck) {
    $runtimeReport = Join-Path (Split-Path $Payload -Parent) ($packageName + '-runtime-check.json')
    $runtimeCheckArgs = @((Join-Path $PSScriptRoot 'distribution/verify-runtime.py'), '--payload', $Payload, '--report', $runtimeReport)
    if ($IncludeTests) { $runtimeCheckArgs += '--include-tests' }
    & (Join-Path $Payload 'runtime/python/python.exe') -I @runtimeCheckArgs
    if ($LASTEXITCODE -ne 0) { throw 'The isolated bundled-runtime check failed; the installer was not produced.' }
}
if ($StageOnly) { Write-Output ('Staged: ' + $Payload); exit 0 }
$compiler = Join-Path $toolsDir 'inno-setup/ISCC.exe'
& $compiler ('/DPayload=' + $Payload) ('/DRelease=' + $Release) ('/DPackageName=' + $packageName) ('/DPackageFlavor=' + $flavor) ('/DOutput=' + (Join-Path $repo 'dist')) (Join-Path $PSScriptRoot 'distribution/installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$installer = Join-Path $repo ('dist/' + $packageName + '-Setup.exe')
Get-FileHash -LiteralPath $installer -Algorithm SHA256 | Select-Object Hash,Path
