$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $root '.runtime\postgres\pgsql\bin'
$data = Join-Path $root '.runtime\pgdata'
$envFile = Join-Path $root '.env'
if (!(Test-Path (Join-Path $bin 'initdb.exe'))) { throw '请先把 PostgreSQL 17 Windows 二进制包解压到 .runtime\postgres，确保存在 pgsql\bin\initdb.exe' }
if (Test-Path $data) { throw '数据库目录已存在；为防覆盖现有数据，初始化已停止。' }
$dbPassword = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$pwFile = Join-Path $root '.runtime\db-password.tmp'
[IO.File]::WriteAllText($pwFile,$dbPassword)
try { & (Join-Path $bin 'initdb.exe') '-D' $data '-U' 'feicui' '--pwfile' $pwFile '-A' 'scram-sha-256' '-E' 'UTF8' } finally { Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue }
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 初始化失败' }
Add-Content -LiteralPath (Join-Path $data 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = 54329`ntimezone = 'Asia/Shanghai'`n"
[IO.File]::WriteAllText($envFile,"DATABASE_URL=`"postgresql://feicui:${dbPassword}@127.0.0.1:54329/feicui?schema=public`"`nSESSION_SECRET=`"$secret`"`nSTORAGE_DIR=`"./storage`"`n")
& (Join-Path $bin 'pg_ctl.exe') '-D' $data '-l' (Join-Path $root '.runtime\postgres.log') 'start'
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 启动失败' }
$env:PGPASSWORD = $dbPassword
& (Join-Path $bin 'createdb.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' 'feicui'
if ($LASTEXITCODE -ne 0) { throw '数据库创建失败' }
Write-Output '数据库已初始化并启动，连接信息已写入 .env（请勿公开）。'
