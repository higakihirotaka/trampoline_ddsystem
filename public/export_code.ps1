$OutputFileName = "gemini_review_code.txt"
$OutputDir = (Get-Location).Path
$OutputFile = Join-Path $OutputDir $OutputFileName

if (Test-Path $OutputFile) { Remove-Item $OutputFile }

Write-Host "--- Starting process ---" -ForegroundColor Cyan

$StreamWriter = New-Object System.IO.StreamWriter($OutputFile, $false, [System.Text.Encoding]::UTF8)

$StreamWriter.WriteLine("========================================")
$StreamWriter.WriteLine("Directory Tree")
$StreamWriter.WriteLine("========================================")
$tree = cmd /c tree /f /a
foreach ($line in $tree) { $StreamWriter.WriteLine($line) }
$StreamWriter.WriteLine("")

$files = Get-ChildItem -Path . -Recurse -File | 
    Where-Object { $_.Extension -match '\.(html|css|js|json)$' } |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|images|img|assets)\\' }
    
$totalFiles = $files.Count
$counter = 0

foreach ($file in $files) {
    $counter++
    $relativePath = $file.FullName.Substring($OutputDir.Length + 1)
    
    Write-Host ("[{0}/{1}] Reading: {2}" -f $counter, $totalFiles, $relativePath)
    
    $StreamWriter.WriteLine("========================================")
    $StreamWriter.WriteLine("File: " + $relativePath)
    $StreamWriter.WriteLine("========================================")
    
    try {
        $content = [System.IO.File]::ReadAllText($file.FullName)
        $StreamWriter.WriteLine($content)
    } catch {
        $StreamWriter.WriteLine("--- Read Error: " + $_.Exception.Message + " ---")
    }
    
    $StreamWriter.WriteLine("")
    $StreamWriter.WriteLine("")
}

$StreamWriter.Close()
$StreamWriter.Dispose()

Write-Host "--- All processes completed ---" -ForegroundColor Green

# 完了メッセージを2秒間だけ表示して自動で閉じる
Start-Sleep -Seconds 2