param([switch]$Test, [switch]$FetchRuntime)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stage = [IO.Path]::GetFullPath((Join-Path $repo 'app/staging'))
$scratch = [IO.Path]::GetFullPath((Join-Path $repo 'app/build-temp'))
foreach ($target in @($stage, $scratch)) {
    if (!$target.StartsWith($repo + [IO.Path]::DirectorySeparatorChar)) { throw 'Build target outside repository' }
}
if (Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($stage + '\') }) {
    throw 'Close the source-built client before rebuilding it.'
}
$bash = 'C:\msys64\usr\bin\bash.exe'
if (!(Test-Path -LiteralPath $bash)) { throw 'MSYS2 is required: install zip, unzip, rsync, python, p7zip.' }
$env:PATH = 'C:\msys64\usr\lib\p7zip;C:\msys64\usr\bin;E:\Git\cmd;E:\nodejs;' + $env:PATH
$env:TMPDIR = (& $bash -c 'cygpath -u "$1"' -- $scratch).Trim()
New-Item -ItemType Directory -Force $scratch | Out-Null
Push-Location $repo
try {
    if ($FetchRuntime -or !(Test-Path app/xulrunner/hash-win-x64)) {
        & $bash app/scripts/fetch_xulrunner -p w -a x64
        if ($LASTEXITCODE -ne 0) { throw 'Gecko runtime download failed' }
    }
    & node scripts/build-research.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    $env:ZOTERO_TEST = if ($Test) { '1' } else { '0' }
    # Full staging includes submodule resources and the optional native test suite.
    & $bash app/scripts/dir_build -p w -a x64 -f
    if ($LASTEXITCODE -ne 0) { throw 'Native staging failed' }
}
finally { Pop-Location }
