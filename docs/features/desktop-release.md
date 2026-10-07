# Qwen 桌面版 Release

## 发布范围与所有者

在个人 fork 发布 Linux x64（AppImage、deb）、Windows x64（NSIS 安装器）、macOS arm64/x64（DMG、ZIP）。版本由 `scripts/desktop-release/release.json` 唯一声明；从当前功能分支的同一个提交构建，保留官方 `main` 基线。发布脚本只在构建期间将根 package 版本替换为发行版本，结束后恢复原始文件，About 和安装器因此使用同一版本。

沿用 Preview 应用身份、`zcodeImageWorkbench=true` 和独立 Qwen 数据目录，包含当前生图、局部重绘及 5/3/2 参考图限制。保持官方自动更新禁用。安装包不内置账号、API Key、本地测试目录或私有上游地址。

现无签名凭据：Windows 为未签名包；macOS 使用本机 ad-hoc 签名，不能冒称 Developer ID 签名或 Apple 公证。发布说明注明首次启动时的系统提示，不关闭用户系统的全局安全设置。

## 构建和发布边界

GitHub Actions 在四个对应操作系统/CPU 的 runner 构建，不用 Linux 交叉编译模拟 macOS/Windows。工作流只读取仓库并上传构建 artifact，不直接发布 Release。每个 job 使用固定 Node/pnpm、锁定依赖和已有 native 工具归档；复用 agent/runtime 准备及 electron-builder 打包、依赖闭包、架构检查流程。

```text
同一 Git commit + release.json
  → 四个独立原生 runner
  → runtime 准备 → 桌面构建 → 安装包 → 打包应用测试 → SHA-256/manifest
  → 全部成功后汇集 artifact
  → 校验四个平台、版本和提交一致
  → 创建草稿 Release → 上传全部安装包与校验文件 → 正式发布
```

失败 job 不阻断其它平台取证，也不产生公开的半成品 Release。修复后重新构建同一批次或明确记录各平台的相同 source commit；禁止用旧版本产物补齐缺失平台。草稿中资产上传失败时可补传相同文件；公开发布是最后一步。签名、构建或测试失败不得记作通过。

## 验收

在目标操作系统使用 Node 24.14.0 / pnpm 10.33.2：

```bash
pnpm install --frozen-lockfile
node scripts/desktop-release/build.mjs
node scripts/desktop-release/test.mjs
```

Linux 无桌面环境时，以 `xvfb-run -a node scripts/desktop-release/test.mjs` 运行打包应用测试。构建结果位于 `dist/desktop-release/artifacts/`，每个平台随附独立 manifest；汇集后按 manifest 生成统一 `SHA256SUMS.txt`。

- 每个平台检查产物名称、架构、版本、内置图像 Skill、图像版元数据和打包依赖。
- Windows 先以 NSIS 静默安装、macOS 从 DMG 复制并卸载映像、Linux 从 deb 解包，再在对应 runner 启动该安装内容。检查应用报告的 CPU 架构、版本、打包状态与图像版元数据；macOS 额外验证代码签名完整性。
- 使用本机模拟 Images 服务验证生成、参考图限制、允许的高分辨率双图，以及错误和草稿恢复；保存截图、日志及测试结果。不调用真实 GPU 上游。
- Linux 执行图像单测；所有平台执行构建和打包应用验收。根类型、Lint、架构和变更文件格式检查在发布前执行，原有 CLI Lint 问题继续单列。
- Windows/macOS 的操作系统签名信任不由自动化绕过；ad-hoc/未签名状态写入 manifest 与 Release 说明。
- 最终下载链接指向个人 fork 的 GitHub Release，校验和与实际上传文件一致。

汇集四个构建 artifact 后，执行 `node scripts/desktop-release/verify.mjs --directory ARTIFACTS --commit FULL_SHA`。该门禁拒绝缺失平台、不同版本/源码、未完成安装后验收及文件校验和不符；通过后生成统一 `SHA256SUMS.txt` 和本地上传清单。

工作流通过 `feat/qwen-image-workbench` 分支上的发布脚本/工作流变更触发，也保留 `workflow_dispatch` 入口供未来合入默认分支后使用。未修改业务状态、RPC schema、服务队列或会话存储。
