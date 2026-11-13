param([switch]$CheckOnly, [switch]$BuildOnly, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$apparelBundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
try {
    if (Test-Path -LiteralPath $apparelBundledPython) { $apparelPython = $apparelBundledPython }
    else { $apparelPython = (Get-Command python -ErrorAction Stop).Source }
    $apparelArgs = @('-X','utf8',(Join-Path $PSScriptRoot 'publish_github.py'))
    if ($CheckOnly) { $apparelArgs += '--check-only' }
    if ($BuildOnly) { $apparelArgs += '--build-only' }
    if ($NoOpen) { $apparelArgs += '--no-open' }
    & $apparelPython @apparelArgs
    exit $LASTEXITCODE
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
}
