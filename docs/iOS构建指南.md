# map-tool iOS App 构建指南（Windows 本机 + GitHub Actions 云端）

> 目标：不出 Mac，用 GitHub Actions 的 macOS runner 把现有 Capacitor 工程编译成 iOS App，
> 自动装进 iOS 模拟器并截图验证。真机 / 上架流程见文末。

## 一、已完成（Windows 本地）

| 项 | 说明 |
|---|---|
| `@capacitor/ios` | 已安装，工程在 `ios/App/App.xcodeproj` |
| Bundle ID | `com.maptool.app` |
| App 名称 | 沿途最顺路 |
| Info.plist | 已加 `NSLocationWhenInUseUsageDescription` / `NSLocationAlwaysAndWhenInUseUsageDescription`（定位授权描述） |
| 定位 | WebView 跑在 `capacitor://localhost`，属安全上下文，浏览器精确定位可用；JS KEY 白名单需含 `localhost` |
| Web 资源 | `npx cap sync ios` 会把 `www/` 同步进 `ios/App/App/public/` |
| Workflow | `.github/workflows/build-ios.yml`：构建模拟器版 → 启动 iPhone 模拟器 → 安装 → 截图 |

## 二、推到 GitHub 触发云端构建

本机 `D:\WorkSpace\map-tool` 还不是 git 仓库，需要先建仓库并推送：

```powershell
cd D:\WorkSpace\map-tool
git init
git add .
git commit -m "init map-tool with capacitor ios"
# 在 GitHub 网页上新建一个空仓库，例如 https://github.com/<你的账号>/map-tool
git remote add origin https://github.com/<你的账号>/map-tool.git
git branch -M main
git push -u origin main
```

推送后：
- 打开仓库 → **Actions** 标签 → 会看到 "Build iOS Simulator App" 正在跑；
- 也可手动触发：Actions → 选中 workflow → **Run workflow**。

## 三、拿构建结果

- 跑完后点开这次运行 → 页面底部 **Artifacts** → 下载 `ios-simulator-result`；
- 里面有：
  - `ios-app.png`：App 在 iOS 模拟器里的截图（验证界面/地图是否正常）；
  - `App.app`：模拟器版 App 包（`.app` 不能直接装真机，真机要签名 ipa）。

## 四、后续：真机与上架（需要 Apple 账号）

本 workflow 出的是**模拟器版**，不签名，只能装模拟器。真机分发：

1. 前提是要 Apple Developer 账号（个人 ¥688/年）；
2. 在 GitHub Actions 里配 4 个 Secrets（仓库 Settings → Secrets and variables → Actions）：
   - `BUILD_CERTIFICATE_BASE64`：iOS Distribution 证书（.p12 转 base64）
   - `P12_PASSWORD`
   - `PROVISION_PROFILE_BASE64`：App ID + 设备 UDID 的 Ad Hoc 描述文件
   - `PROVISION_PROFILE_NAME`
3. workflow 里加一步 `xcodebuild -exportArchive` 导出 ipa，再用重签名脚本（如 `fastlane gym`）；
4. 打包出的 ipa 通过 TestFlight 或蒲公英 / 企业分发安装到真机。

现阶段建议：先用模拟器版 workflow 验证 App 在 iOS 上能正常跑，真机/上架等确认要投入时再做。

## 五、常见问题

- **`xcodebuild: scheme App not found`**：macOS runner 的 Xcode 版本可能与工程要求不符，
  换 `runs-on: macos-15` 或在本地用 `npx cap add ios` 重新生成工程再推。
- **地图空白**：模拟器 GPU 渲染问题，真机一般正常；也可检查 JS KEY 白名单是否包含 `localhost`。
- **定位失败**：确认 Info.plist 的两个定位描述键都在（步骤一已完成）；首次启动会弹授权框，点"使用 App 期间允许"。
