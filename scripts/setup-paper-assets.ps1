param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$environment = Join-Path (Split-Path $repo -Parent) '.tools/pdf-assets-env'
& $Python -m venv $environment
if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ is required for deterministic PDF parsing' }
& (Join-Path $environment 'Scripts/python.exe') -m pip install PyMuPDF==1.27.2.2 openpyxl==3.1.5 python-docx==1.2.0
if ($LASTEXITCODE -ne 0) { throw 'PyMuPDF installation failed' }
