<#
.SYNOPSIS
  iOS project local self-check: integrity, web asset sync, config, git status.
.USAGE
  powershell -ExecutionPolicy Bypass -File .\check-ios.ps1
#>
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

function OK($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function WARN($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function FAIL($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red }

Write-Host ""
Write-Host "===== iOS Project Self-Check =====" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/5] Required files" -ForegroundColor White
$required = @(
  'ios\App\App.xcodeproj\project.pbxproj',
  'ios\App\App\Info.plist',
  'ios\App\App\AppDelegate.swift',
  'ios\App\App\capacitor.config.json',
  'ios\App\App\public\index.html',
  'www\index.html',
  'package.json',
  'package-lock.json',
  '.github\workflows\build-ios.yml'
)
$missing = @($required | Where-Object { -not (Test-Path $_) })
if ($missing.Count -eq 0) { OK "All $($required.Count) required files exist" }
else { $missing | ForEach-Object { FAIL "Missing: $_" } }

Write-Host ""
Write-Host "[2/5] Web asset sync (www -> ios public)" -ForegroundColor White
function Get-Hash($p) {
  if (Test-Path $p) { (Get-FileHash $p -Algorithm SHA256).Hash } else { $null }
}
$webFiles = @('index.html','app.js','styles.css','manifest.webmanifest','sw.js')
$diff = @()
foreach ($f in $webFiles) {
  $a = Get-Hash "www\$f"
  $b = Get-Hash "ios\App\App\public\$f"
  if ($a -ne $b) {
    $ah = if ($a) { $a.Substring(0,8) } else { 'none' }
    $bh = if ($b) { $b.Substring(0,8) } else { 'none' }
    $diff += "$f (www=$ah ios=$bh)"
  }
}
if ($diff.Count -eq 0) { OK "www and ios public are identical" }
else {
  WARN "Out of sync. Run: npx cap sync ios"
  $diff | ForEach-Object { Write-Host "         $_" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "[3/5] iOS config" -ForegroundColor White
$plist = Get-Content 'ios\App\App\Info.plist' -Raw
if ($plist -match 'NSLocationWhenInUseUsageDescription') { OK "Location permission desc configured" } else { FAIL "Missing NSLocationWhenInUseUsageDescription" }
if ($plist -match '\xe6\xb2\xbf\xe9\x80\x94\xe6\x9c\x80\xe9\xa1\xba\xe8\xb7\xaf') { OK "App display name set" } else { WARN "Check app display name in Info.plist" }
$pbx = Get-Content 'ios\App\App.xcodeproj\project.pbxproj' -Raw
if ($pbx -match 'PRODUCT_BUNDLE_IDENTIFIER = com\.maptool\.app') { OK "Xcode Bundle ID: com.maptool.app" } else { FAIL "Xcode Bundle ID unexpected" }

Write-Host ""
Write-Host "[4/5] Dependencies" -ForegroundColor White
$pkg = Get-Content 'package.json' -Raw
foreach ($d in @('@capacitor/ios','@capacitor/cli','@capacitor/core','@capacitor/android')) {
  if ($pkg -match [regex]::Escape($d)) { OK "$d declared" } else { WARN "$d not in package.json" }
}
if (Test-Path 'node_modules\@capacitor\ios') { OK "@capacitor/ios installed" } else { FAIL "Not installed. Run: npm install" }

Write-Host ""
Write-Host "[5/5] Git status" -ForegroundColor White
$branch = git branch --show-current
$local  = git rev-parse HEAD
$remote = git rev-parse '@{u}' 2>$null
OK "Branch: $branch"
if ($local -eq $remote) { OK "Local matches remote ($($local.Substring(0,7)))" }
else { WARN "Local/remote differ. Run: git push. local=$($local.Substring(0,7)) remote=$($remote.Substring(0,7))" }
$status = git status --short
if ($status) { WARN "Uncommitted changes:"; $status | ForEach-Object { Write-Host "         $_" -ForegroundColor Yellow } }
else { OK "Working tree clean" }

Write-Host ""
Write-Host "===== Done =====" -ForegroundColor Cyan
Write-Host "Cloud build results: https://github.com/cofmass/map-tool/actions" -ForegroundColor White
Write-Host ""
