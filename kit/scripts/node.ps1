# Use the runtime recorded by setup configs, including a portable Node installation.
# Arguments are forwarded as an array; never interpret them as PowerShell code.
# runtime.json is UTF-8 without BOM; Windows PowerShell 5.1 would otherwise read it as ANSI and break non-ASCII user paths.
$ErrorActionPreference = 'Stop'
$mailhubRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$mailhubState = if ($env:MAILHUB_STATE_DIR) { $env:MAILHUB_STATE_DIR } else { Join-Path $mailhubRoot '.mailhub' }
$mailhubRuntime = Join-Path $mailhubState 'runtime.json'
try {
    if (Test-Path -LiteralPath $mailhubRuntime) {
        $mailhubNode = (Get-Content -LiteralPath $mailhubRuntime -Raw -Encoding UTF8 | ConvertFrom-Json).execPath
        if (!$mailhubNode -or !(Test-Path -LiteralPath $mailhubNode -PathType Leaf)) {
            throw 'Saved Node runtime is missing. Run setup.mjs configs using your working Node installation.'
        }
    } else {
        $mailhubNode = (Get-Command node.exe -ErrorAction Stop).Source
    }
    Set-Location -LiteralPath $mailhubRoot
    & $mailhubNode @args
    exit $LASTEXITCODE
} catch {
    Write-Error -ErrorAction Continue $_
    exit 1
}
