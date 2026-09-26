$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$line=Get-Content (Join-Path $root '.env') | Where-Object { $_ -like 'DATABASE_URL=*' }
$source=$line.Substring(14).Trim('"')
$url=[Uri]$source
$env:PGPASSWORD=$url.UserInfo.Split(':')[1]
$env:DATABASE_URL=$source.Replace('/feicui?','/feicui_test?')
& (Join-Path $root '.runtime\postgres\pgsql\bin\createdb.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' 'feicui_test' 2>$null
Push-Location $root
try {
  & '.\node_modules\.bin\prisma.cmd' 'migrate' 'deploy'
  if($LASTEXITCODE -ne 0){throw '测试数据库迁移失败'}
  & '.\node_modules\.bin\vitest.cmd' 'run'
  if($LASTEXITCODE -ne 0){throw '自动验收失败'}
} finally { Pop-Location; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
