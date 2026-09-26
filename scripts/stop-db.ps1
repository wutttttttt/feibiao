$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
& (Join-Path $root '.runtime\postgres\pgsql\bin\pg_ctl.exe') '-D' (Join-Path $root '.runtime\pgdata') '-m' 'fast' 'stop'
