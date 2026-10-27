<#
.SYNOPSIS
  FinChart Source Code Backup Script
.DESCRIPTION
  Creates a timestamped snapshot of the FinChart source code (excluding
  node_modules, dist, .git, and other build artifacts).
  Outputs a compressed .zip archive to the backup directory.
.PARAMETER BackupDir
  Destination folder for backups. Defaults to D:\2026\Temp\FinChart-Backups
.PARAMETER Tag
  Optional tag appended to the filename, e.g. "pre-refactor" → 
  FinChart_2026-06-12_1653_pre-refactor.zip
.PARAMETER DryRun
  List what would be included without creating the archive.
.EXAMPLE
  .\backup.ps1
  .\backup.ps1 -Tag "v1-transpiler"
  .\backup.ps1 -BackupDir "E:\backups" -Tag "milestone"
  .\backup.ps1 -DryRun
#>
param(
  [string]$BackupDir = "D:\2026\Temp\FinChart-Backups",
  [string]$Tag = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# ── Config ──
$SourceRoot = "D:\2026\Temp\FinChart"
$Timestamp  = Get-Date -Format "yyyy-MM-dd_HHmm"
$TagSuffix  = if ($Tag) { "_$Tag" } else { "" }
$ZipName    = "FinChart_${Timestamp}${TagSuffix}.zip"
$ZipPath    = Join-Path $BackupDir $ZipName

# Folders to exclude (relative names)
$ExcludeDirs = @(
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  ".vite",
  ".cache",
  "coverage",
  ".system_generated"
)

# File patterns to exclude
$ExcludeFiles = @(
  "*.map",
  "*.tsbuildinfo",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml"
)

# ── Gather files ──
Write-Host ""
Write-Host "  FinChart Backup" -ForegroundColor Cyan
Write-Host "  ===============" -ForegroundColor Cyan
Write-Host "  Source : $SourceRoot"
Write-Host "  Output : $ZipPath"
Write-Host ""

$allFiles = Get-ChildItem -Path $SourceRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $path = $_.FullName
    $relPath = $path.Substring($SourceRoot.Length)
    
    # Skip excluded directories
    $skip = $false
    foreach ($dir in $ExcludeDirs) {
      if ($relPath -match "[\\/]$dir[\\/]") { $skip = $true; break }
    }
    if ($skip) { return $false }
    
    # Skip excluded file patterns
    foreach ($pat in $ExcludeFiles) {
      if ($_.Name -like $pat) { return $false }
    }
    
    return $true
  }

$totalFiles = $allFiles.Count
$totalSize  = ($allFiles | Measure-Object -Property Length -Sum).Sum
$sizeMB     = [math]::Round($totalSize / 1MB, 1)

Write-Host "  Files  : $totalFiles"
Write-Host "  Size   : ${sizeMB} MB (before compression)"
Write-Host ""

# ── Breakdown by folder ──
$breakdown = $allFiles | 
  ForEach-Object {
    $rel = $_.FullName.Substring($SourceRoot.Length + 1)
    $top = ($rel -split '[\\/]')[0]
    [PSCustomObject]@{ Folder = $top; Size = $_.Length }
  } |
  Group-Object Folder |
  Select-Object @{N="Folder";E={$_.Name}}, Count, @{N="SizeMB";E={[math]::Round(($_.Group | Measure-Object Size -Sum).Sum / 1MB, 1)}} |
  Sort-Object SizeMB -Descending

Write-Host "  Breakdown:" -ForegroundColor Yellow
foreach ($b in $breakdown) {
  $bar = "█" * [math]::Min([math]::Max([int]($b.SizeMB * 2), 1), 40)
  Write-Host ("    {0,-25} {1,5} files  {2,6} MB  {3}" -f $b.Folder, $b.Count, $b.SizeMB, $bar) -ForegroundColor Gray
}
Write-Host ""

if ($DryRun) {
  Write-Host "  [DRY RUN] No archive created." -ForegroundColor Yellow
  Write-Host ""
  return
}

# ── Create archive ──
if (!(Test-Path $BackupDir)) {
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  Write-Host "  Created backup directory: $BackupDir" -ForegroundColor DarkGray
}

# Use a temp staging directory to preserve folder structure
$stagingDir = Join-Path $env:TEMP "finchart-backup-$Timestamp"
if (Test-Path $stagingDir) { Remove-Item -Recurse -Force $stagingDir }

Write-Host "  Staging files..." -ForegroundColor DarkGray
foreach ($file in $allFiles) {
  $relPath = $file.FullName.Substring($SourceRoot.Length + 1)
  $destPath = Join-Path $stagingDir $relPath
  $destDir = Split-Path $destPath -Parent
  if (!(Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
  Copy-Item $file.FullName $destPath
}

Write-Host "  Compressing..." -ForegroundColor DarkGray
Compress-Archive -Path "$stagingDir\*" -DestinationPath $ZipPath -Force

# Cleanup staging
Remove-Item -Recurse -Force $stagingDir

$zipSize = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)

Write-Host ""
Write-Host "  ✅ Backup complete!" -ForegroundColor Green
Write-Host "     $ZipPath" -ForegroundColor White
Write-Host "     ${zipSize} MB compressed (${sizeMB} MB → ${zipSize} MB)" -ForegroundColor DarkGray
Write-Host ""

# ── List existing backups ──
$existing = Get-ChildItem $BackupDir -Filter "FinChart_*.zip" | Sort-Object LastWriteTime -Descending
if ($existing.Count -gt 1) {
  Write-Host "  All backups:" -ForegroundColor Yellow
  foreach ($bk in $existing) {
    $age = (Get-Date) - $bk.LastWriteTime
    $ageStr = if ($age.TotalHours -lt 1) { "{0}m ago" -f [int]$age.TotalMinutes }
              elseif ($age.TotalDays -lt 1) { "{0}h ago" -f [int]$age.TotalHours }
              else { "{0}d ago" -f [int]$age.TotalDays }
    $sz = [math]::Round($bk.Length / 1MB, 1)
    Write-Host ("    {0,-50} {1,6} MB  {2}" -f $bk.Name, $sz, $ageStr) -ForegroundColor Gray
  }
  Write-Host ""
}
