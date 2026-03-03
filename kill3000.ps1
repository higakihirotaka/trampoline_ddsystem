$pid3000 = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue).OwningProcess
if ($pid3000) { Stop-Process -Id $pid3000 -Force; Write-Host "Killed PID $pid3000" }
else { Write-Host "No process on port 3000" }
