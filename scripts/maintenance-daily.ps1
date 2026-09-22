$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskProject
& 'C:\Program Files\nodejs\node.exe' 'scripts/maintenance-daily.mjs'
exit $LASTEXITCODE
