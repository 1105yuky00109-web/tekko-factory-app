# 自動Gitコミットスクリプト (auto-commit.ps1)
# Windows タスクスケジューラから定期実行されます

$projectDir = "C:\Users\areva\.gemini\antigravity\scratch\weekly-report-app"
$logFile = "$projectDir\auto-commit.log"

Set-Location $projectDir

# 変更があるか確認
$status = git status --porcelain
if ($status) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git add -A
    git commit -m "自動バックアップ: $timestamp"
    $msg = "[$timestamp] コミット成功: $($status.Count)件の変更"
    Add-Content -Path $logFile -Value $msg
    Write-Host $msg
} else {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $msg = "[$timestamp] 変更なし - スキップ"
    Add-Content -Path $logFile -Value $msg
    Write-Host $msg
}
