param([Parameter(Mandatory=$true)][string]$BackupDirectory)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$backupRoot=[IO.Path]::GetFullPath((Join-Path $root 'backups'))
$backup=[IO.Path]::GetFullPath($BackupDirectory)
if(!$backup.StartsWith($backupRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '备份路径必须位于项目 backups 目录内'}
if(!(Test-Path (Join-Path $backup 'database.dump'))){throw '缺少 database.dump'}
$line=Get-Content (Join-Path $root '.env') | Where-Object { $_ -like 'DATABASE_URL=*' }
$url=[Uri]$line.Substring(14).Trim('"')
$env:PGPASSWORD=$url.UserInfo.Split(':')[1]
$bin=Join-Path $root '.runtime\postgres\pgsql\bin'
$database='feicui_restore_'+(Get-Date -Format 'yyyyMMddHHmmss')
try {
  & (Join-Path $bin 'createdb.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' $database
  if($LASTEXITCODE -ne 0){throw '独立恢复数据库创建失败'}
  & (Join-Path $bin 'pg_restore.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' '-d' $database '--no-owner' (Join-Path $backup 'database.dump')
  if($LASTEXITCODE -ne 0){throw '备份恢复失败'}
  $manifestPath=Join-Path $backup 'counts.json'
  if(Test-Path -LiteralPath $manifestPath){
    $expected=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $raw=& (Join-Path $bin 'psql.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' '-d' $database '-v' 'ON_ERROR_STOP=1' '-tA' '-f' (Join-Path $root 'scripts\backup-counts.sql')
    if($LASTEXITCODE -ne 0 -or !$raw){throw '恢复后业务表数量读取失败'}
    $actual=($raw -join "`n") | ConvertFrom-Json
    foreach($property in $expected.PSObject.Properties){
      if([long]$property.Value -ne [long]$actual.($property.Name)){throw "业务表 $($property.Name) 数量不一致：备份 $($property.Value)，恢复 $($actual.($property.Name))"}
    }
  }
  $out=Join-Path $root ".runtime\restore-verification\$database"
  if(Test-Path (Join-Path $backup 'storage')){New-Item -ItemType Directory -Force -Path $out|Out-Null;Copy-Item -LiteralPath (Join-Path $backup 'storage') -Destination (Join-Path $out 'storage') -Recurse}
  $goodCount=(& (Join-Path $bin 'psql.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' '-d' $database '-tAc' 'SELECT COUNT(*) FROM "Good"').Trim()
  if($LASTEXITCODE -ne 0){throw '恢复后货品校验失败'}
  $imageCount=(& (Join-Path $bin 'psql.exe') '-h' '127.0.0.1' '-p' '54329' '-U' 'feicui' '-d' $database '-tAc' 'SELECT COUNT(*) FROM "GoodImage"').Trim()
  if($LASTEXITCODE -ne 0){throw '恢复后图片记录校验失败'}
  $sourceImages=Join-Path $backup 'storage'
  $restoredImages=Join-Path $out 'storage'
  $files=if(Test-Path $sourceImages){@(Get-ChildItem -LiteralPath $sourceImages -Recurse -File)}else{@()}
  if($files.Count -ne [int]$imageCount){throw "图片文件数与数据库记录不符：$($files.Count) / $imageCount"}
  foreach($file in $files){
    $relative=$file.FullName.Substring($sourceImages.Length).TrimStart('\','/')
    $restored=Join-Path $restoredImages $relative
    if(!(Test-Path -LiteralPath $restored)){throw "恢复缺少图片：$relative"}
    if((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $restored -Algorithm SHA256).Hash){throw "图片校验不一致：$relative"}
  }
  Write-Output "已恢复到独立数据库 $database；货品 $goodCount 件，图片 $imageCount 张且文件校验一致。$(if(Test-Path -LiteralPath $manifestPath){'业务表数量逐表一致。'}else{'旧备份无逐表数量清单。'})未覆盖原数据库。"
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
