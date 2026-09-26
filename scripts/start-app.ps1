$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$runtime=Join-Path $root '.runtime'
$pidFile=Join-Path $runtime 'app.pid'
$cli=Join-Path $root 'node_modules\next\dist\bin\next'
if(!(Test-Path -LiteralPath (Join-Path $root '.next\BUILD_ID'))){throw '尚未构建生产版本，请先运行 npm run build'}
if(!(Test-Path -LiteralPath $cli)){throw '缺少 Next.js，请先运行 npm install'}
if(Test-Path -LiteralPath $pidFile){
  $saved=(Get-Content -LiteralPath $pidFile -Raw).Trim().Split('|')
  if($saved.Count -eq 2){
    $existing=Get-Process -Id ([int]$saved[0]) -ErrorAction SilentlyContinue
    if($existing -and $existing.StartTime.Ticks -eq [long]$saved[1]){Write-Output '业务系统已经运行';exit 0}
  }
  Remove-Item -LiteralPath $pidFile -Force
}
$node=(Get-Command node.exe -ErrorAction Stop).Source
$process=Start-Process -FilePath $node -ArgumentList @($cli,'start','--hostname','127.0.0.1') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'app.stdout.log') -RedirectStandardError (Join-Path $runtime 'app.stderr.log') -PassThru
[IO.File]::WriteAllText($pidFile,"$($process.Id)|$($process.StartTime.Ticks)")
for($i=0;$i -lt 20;$i++){
  Start-Sleep -Milliseconds 500
  try{$response=Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 2;if($response.StatusCode -eq 200){Write-Output '业务系统已启动：http://127.0.0.1:3000/';exit 0}}catch{}
  if($process.HasExited){break}
}
throw "业务系统未能启动，请检查 $runtime\app.stderr.log"
