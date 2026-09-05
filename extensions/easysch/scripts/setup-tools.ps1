$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$tools = Join-Path (Split-Path $repo -Parent) '.tools'
New-Item -ItemType Directory -Force $tools | Out-Null
function Download-File($url, $target) {
    if (-not (Test-Path -LiteralPath $target)) {
        curl.exe -L --fail --retry 2 --output $target $url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
    }
}
Download-File 'https://github.com/jgm/pandoc/releases/download/3.11/pandoc-3.11-windows-x86_64.zip' (Join-Path $tools 'pandoc.zip')
if (-not (Test-Path -LiteralPath (Join-Path $tools 'pandoc/pandoc-3.11/pandoc.exe'))) {
    Expand-Archive -LiteralPath (Join-Path $tools 'pandoc.zip') -DestinationPath (Join-Path $tools 'pandoc')
}
Download-File 'https://download.zotero.org/client/release/7.0.32/Zotero-7.0.32_x64_setup.exe' (Join-Path $tools 'Zotero-7.0.32_x64_setup.exe')
Download-File 'https://www.7-zip.org/a/7zr.exe' (Join-Path $tools '7zr.exe')
if (-not (Test-Path -LiteralPath (Join-Path $tools 'zotero/core/zotero.exe'))) {
    & (Join-Path $tools '7zr.exe') x (Join-Path $tools 'Zotero-7.0.32_x64_setup.exe') ('-o' + (Join-Path $tools 'zotero')) -y
    if ($LASTEXITCODE -ne 0) { throw 'Zotero extraction failed' }
}
Write-Output ('Pandoc: ' + (Join-Path $tools 'pandoc/pandoc-3.11/pandoc.exe'))
Write-Output ('Zotero: ' + (Join-Path $tools 'zotero/core/zotero.exe'))
