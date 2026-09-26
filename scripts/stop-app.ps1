$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$pidFile=Join-Path $root '.runtime\app.pid'
if(!(Test-Path -LiteralPath $pidFile)){Write-Output '业务系统未记录为运行中';exit 0}
$saved=(Get-Content -LiteralPath $pidFile -Raw).Trim().Split('|')
if($saved.Count -ne 2){throw '业务系统进程记录无效，未停止任何进程'}
$process=Get-Process -Id ([int]$saved[0]) -ErrorAction SilentlyContinue
if($process -and $process.StartTime.Ticks -eq [long]$saved[1]){Stop-Process -Id $process.Id -Force;Write-Output '业务系统已停止'}
else{Write-Output '原业务系统进程已不存在'}
Remove-Item -LiteralPath $pidFile -Force
