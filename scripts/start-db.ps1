$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$pgCtl=Join-Path $root '.runtime\postgres\pgsql\bin\pg_ctl.exe'
$data=Join-Path $root '.runtime\pgdata'
& (Join-Path $root '.runtime\postgres\pgsql\bin\pg_isready.exe') '-h' '127.0.0.1' '-p' '54329' *> $null
if($LASTEXITCODE -eq 0){Write-Output '本机数据库已经运行';exit 0}
& $pgCtl '-D' $data '-l' (Join-Path $root '.runtime\postgres.log') 'start'
if($LASTEXITCODE -ne 0){throw '本机数据库启动失败；请查看 .runtime/postgres.log'}
