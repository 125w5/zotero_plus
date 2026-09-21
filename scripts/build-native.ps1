param([switch]$Test, [switch]$FetchRuntime, [switch]$Incremental)
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
    $readerBundle = Join-Path $repo 'reader/build/zotero/reader.js'
    $readerInputs = @(Get-ChildItem -LiteralPath (Join-Path $repo 'reader/src') -File -Recurse)
    $readerInputs += Get-Item -LiteralPath (Join-Path $repo 'chrome/content/zotero/research/shared/annotation-geometry.mjs')
    $readerLatest = ($readerInputs | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
    if (!(Test-Path -LiteralPath $readerBundle) -or (Get-Item -LiteralPath $readerBundle).LastWriteTimeUtc -lt $readerLatest) {
        Push-Location (Join-Path $repo 'reader')
        try {
            & node node_modules/webpack/bin/webpack.js --config-name zotero
            if ($LASTEXITCODE -ne 0) { throw 'Local reader bundle failed' }
        } finally { Pop-Location }
    }
    $noteBundle = Join-Path $repo 'note-editor/build/zotero/editor.js'
    $noteLatest = (Get-ChildItem -LiteralPath (Join-Path $repo 'note-editor/src') -File -Recurse | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
    if (!(Test-Path -LiteralPath $noteBundle) -or (Get-Item -LiteralPath $noteBundle).LastWriteTimeUtc -lt $noteLatest) {
        Push-Location (Join-Path $repo 'note-editor')
        try {
            & node node_modules/webpack/bin/webpack.js --node-env production --config-name zotero
            if ($LASTEXITCODE -ne 0) { throw 'Local note editor bundle failed' }
        } finally { Pop-Location }
    }
    & node services/research-engine/build-browser.mjs
    if ($LASTEXITCODE -ne 0) { throw 'PPT graph editor bundle failed' }
    if ($FetchRuntime -or !(Test-Path app/xulrunner/hash-win-x64)) {
        & $bash app/scripts/fetch_xulrunner -p w -a x64
        if ($LASTEXITCODE -ne 0) { throw 'Gecko runtime download failed' }
    }
    & node scripts/build-research.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    $env:ZOTERO_TEST = if ($Test) { '1' } else { '0' }
    # Full staging includes submodule resources and the optional native test suite.
    if ($Incremental) { & $bash app/scripts/dir_build -p w -a x64 }
    else { & $bash app/scripts/dir_build -p w -a x64 -f }
    if ($LASTEXITCODE -ne 0) { throw 'Native staging failed' }
}
finally { Pop-Location }
