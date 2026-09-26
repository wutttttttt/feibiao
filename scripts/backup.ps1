$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$target=Join-Path $root "backups\$stamp"
New-Item -ItemType Directory -Force -Path $target | Out-Null
$maintenance=Join-Path $root '.runtime\maintenance'
if(Test-Path $maintenance){throw '已有备份正在进行'}
[IO.File]::WriteAllText($maintenance,(Get-Date).ToString('o'))
$envLine=Get-Content (Join-Path $root '.env') | Where-Object { $_ -like 'DATABASE_URL=*' }
$url=$envLine.Substring(14).Trim('"')
$u=[Uri]$url
$env:PGPASSWORD=$u.UserInfo.Split(':')[1]
try {
  & (Join-Path $root '.runtime\postgres\pgsql\bin\pg_dump.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' '-Fc' '-f' (Join-Path $target 'database.dump') 'feicui'
  if ($LASTEXITCODE -ne 0) { throw '数据库备份失败' }
  $counts=& (Join-Path $root '.runtime\postgres\pgsql\bin\psql.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' '-d' 'feicui' '-v' 'ON_ERROR_STOP=1' '-tA' '-f' (Join-Path $root 'scripts\backup-counts.sql')
  if ($LASTEXITCODE -ne 0 -or !$counts) { throw '业务表数量清单生成失败' }
  [IO.File]::WriteAllText((Join-Path $target 'counts.json'),(($counts -join "`n").Trim()))
  if (Test-Path (Join-Path $root 'storage')) { Copy-Item -LiteralPath (Join-Path $root 'storage') -Destination (Join-Path $target 'storage') -Recurse }
  Write-Output "备份完成：$target。恢复时需同时恢复 database.dump 与 storage 目录。"
} finally { Remove-Item -LiteralPath $maintenance -Force -ErrorAction SilentlyContinue; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
