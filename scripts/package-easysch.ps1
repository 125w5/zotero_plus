param(
    [string]$Release = '0.1.0-preview.20260917',
    [string]$CredentialFile,
    [switch]$StageOnly,
    [switch]$IncludeTests,
    [string]$Payload
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsDir = Join-Path (Split-Path $repo -Parent) '.tools'
$pythonHome = 'C:\Users\wgy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python'
if (!$Payload) { $Payload = Join-Path $repo ('dist/EasySch-' + $Release + '-Windows-x64') }
$Payload = [IO.Path]::GetFullPath($Payload)
$argsForStage = @((Join-Path $PSScriptRoot 'distribution/stage.py'), '--repo', $repo, '--tools', $toolsDir,
    '--output', $Payload, '--node', (Get-Command node).Source, '--python-home', $pythonHome, '--release', $Release)
if ($CredentialFile) { $argsForStage += @('--credentials', [IO.Path]::GetFullPath($CredentialFile)) }
if ($IncludeTests) { $argsForStage += '--include-tests' }
& (Join-Path $pythonHome 'python.exe') @argsForStage
if ($LASTEXITCODE -ne 0) { throw 'Payload staging failed.' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll ('/win32icon:' + (Join-Path $Payload 'EasySch.ico')) ('/out:' + (Join-Path $Payload 'EasySch.exe')) (Join-Path $PSScriptRoot 'distribution/launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
if ($StageOnly) { Write-Output ('Staged: ' + $Payload); exit 0 }
$compiler = Join-Path $toolsDir 'inno-setup/ISCC.exe'
& $compiler ('/DPayload=' + $Payload) ('/DRelease=' + $Release) ('/DOutput=' + (Join-Path $repo 'dist')) (Join-Path $PSScriptRoot 'distribution/installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$installer = Join-Path $repo ('dist/EasySch-' + $Release + '-Windows-x64-Setup.exe')
Get-FileHash -LiteralPath $installer -Algorithm SHA256 | Select-Object Hash,Path
