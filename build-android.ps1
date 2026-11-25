# map-tool Android 构建脚本
# 前提：已安装 Android Studio（含 SDK）或命令行 SDK，JAVA_HOME 指向 JDK 17+
param(
  [string]$JavaHome = "D:\JDK\JDKS\jdk21",
  [string]$SdkPath = "D:\Andriod_studio\sdk"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 1. 同步 web 资源
Copy-Item index.html,styles.css,app.js,manifest.webmanifest,sw.js www\ -Force
Copy-Item icons www\icons -Recurse -Force
npx cap copy android
if ($LASTEXITCODE -ne 0) { exit 1 }

# 2. 找 Android SDK
$sdk = $SdkPath
Write-Host "SDK: $sdk"

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $sdk
$env:Path = "$sdk\platform-tools;$env:Path"

# 3. Gradle 构建 debug apk
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "APK 输出: $PSScriptRoot\android\app\build\outputs\apk\debug\app-debug.apk"
