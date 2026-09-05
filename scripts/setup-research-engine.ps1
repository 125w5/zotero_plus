$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location (Join-Path $repo 'services/research-engine')
try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Research engine dependency installation failed' }
    & node --test test/engine.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Research engine verification failed' }
} finally { Pop-Location }
