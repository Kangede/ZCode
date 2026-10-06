# Qwen 图像画布使用与维护

本 fork 在官方 ZCode 3.14.3 / `29628c9` 上增加可关闭的原生图像工具、系统 Skill 和共享画布。桌面与 Web 使用同一个界面，CLI/TUI 使用同一个会话任务服务。支持涂抹局部重绘、会话图片引用和独立生图服务配置。

## 安装与启用

Linux 桌面包位于 `dist/image-desktop/`，使用独立的 ZCode Preview 身份，并关闭官方自动更新。CLI/Web 压缩包位于 `dist/image-cli/releases/`；解压后使用 Node 24.14.0 运行 `node zcode/bin/zcode.mjs`，加 `--web --no-open` 可启动浏览器版。仅在可信本机监听时使用 `--no-token`；默认网络监听保留官方认证行为。

定制包默认数据根为 `~/.zcode-profiles/qwen-image/`，其中 `.zcode/` 保存数据。已有显式 ZCODE 路径配置优先；不要把它们指向官方数据目录，除非确实希望共享数据。源码开发与普通官方构建保持原来的目录规则。

1. 在 ZCode 的服务商设置中配置自己的代理地址和密钥，选择对话模型，例如 `glm-5.3`。
2. 点击“新建图像”，从画布右上角打开“生图服务设置”，打开“启用生图”。点击“添加生图服务”，单独填写名称、地址和 API key，或明确选择已配置的服务。生图不再跟随会话模型。
3. 模型别名默认为 `Qwen-Image-2.1`。代理须公开 `/v1/models` 和 Images API，并为当前密钥授权生图。
4. 直接填写面板，或关闭面板后用自然语言要求生成图片。自然语言操作使用现有工具权限机制；审批后自动打开画布。

CLI 单独使用时，可在默认 CLI 配置文件中合并以下片段。定制包的路径是 `~/.zcode-profiles/qwen-image/.zcode/cli/config.json`；普通源码运行沿用 `~/.zcode/cli/config.json`。

```json
{
  "imageGeneration": {
    "enabled": true,
    "providerId": "your-image-provider-id",
    "model": "Qwen-Image-2.1",
    "timeoutMs": 1200000
  }
}
```

`providerId` 必须指向 ZCode 中已配置的 API-key Provider；省略时提示配置错误，不自动使用聊天服务。旧会话需在画布中明确选择一次；独立服务配置可供其它会话选择。配置文件中显式提供的字段在新会话启动时优先于画布保存的选项。关闭功能可取消画布勾选；若配置文件显式启用，还需把其中 `enabled` 改为 `false`。关闭后仍能查看历史图片。

## 画布与调整面板

画布采用以图像为中心的布局：顶部保留模型、下载和图像操作，底部固定提示词输入区，历史版本以缩略图显示。尺寸、格式和高级参数从输入区左下角的参数摘要打开；参考图按钮打开上传和会话图片选择器。服务地址、密钥与模型配置收在右上角的“生图服务设置”中。

在输入区按 Ctrl/⌘+Enter 可提交。涂抹时只显示一条悬浮工具栏，返回箭头退出选区模式并保留提示词；关闭参数或参考图面板不会清空涂抹。手机宽度下，生成/取消按钮仍固定在可见区域。

## 调整与导出

选择完成的版本，点击“继续调整”，再填写变化要求。编辑目标占一个参考图名额，总计最多五张；Picture 1–5 对应提交时的顺序。可上传、拖放、移除和排序参考图，也可点击“从会话图片选择”选择本会话任意已完成图片，按点击顺序加入，不重复上传。每次编辑保留旧版本；选定任意旧版本可重新开始编辑。

参数变化只修改草稿，点击“生成图片”或“应用调整”后才提交。输出默认为 1024×1024、40 步、CPU 随机数生成、Cache-DiT 关闭。种子留空时，生成使用 42，编辑选择不同于已知参考图种子的新值。尺寸须为 32 的倍数，并属于七种支持的比例。引导强度超过 1 时须填写负面提示词。

透明背景只支持 PNG。普通图片中的零星 Alpha 像素不会被当成移除背景的指令；透明版本的后续编辑会继承原请求的透明设置。当前上游直接输出 JPEG 会触发 `cannot write mode RGBA as JPEG`，因此 Qwen 适配器固定请求一次 PNG，再按指定质量在 Host 合成白底并编码 JPEG，默认质量 90（界面中的 0 映射为编码器最低质量 1）；结果元数据记录此处理。参考图始终使用原始字节。

右上角“下载”保存到客户端；“更多操作 → 导出到项目”写入会话工作区的 `output/qwen-image/`，使用唯一文件名。已保存的密钥在设置读取中显示为掩码，保留掩码即可保留原值，输入新值或清空可替换或删除密钥。网络请求与密钥只在 Host 上处理，浏览器通过既有连接读取图片产物。CLI/TUI 返回文件路径、图像 ID 和元数据。

## 涂抹局部重绘

选中已完成图片，点击“涂抹重绘”，用画笔选中要修改的区域，然后填写调整说明并点击“应用调整”。支持触屏、画笔大小、橡皮擦、撤销、清空；键盘方向键移动画笔，空格涂抹。缩放不会改变选区在原图中的位置。选区为空时不能提交；新建图片或更换编辑目标会清空选区。

局部重绘固定原图尺寸并输出 PNG，编辑目标锁定为 Picture 1，还可从会话添加其它参考图。当前代理不支持原生扩散蒙版，因此 ZCode 给 Qwen 提供选区标记，并在 Host 按蒙版合成返回结果。未涂抹区域的 RGBA 像素保持原样；选区内的生成质量仍需查看结果。每次重绘生成新版本，旧图和原始参考文件保留。

CLI 的 `GenerateImage` 支持 `mask` 参数，值为本会话导入的蒙版 ID 或工作区内的 PNG 路径；蒙版必须与目标同尺寸，透明处重绘，不透明处保留。原来的无蒙版编辑保持可用。连接旧版生图 Host 时隐藏涂抹按钮。

## 取消、恢复与故障

画布显示等待阶段和耗时，不显示伪造的扩散百分比。关闭浏览器或重连不取消任务，也不会重新发起 POST。取消会中止 Host 的网络请求，但不保证上游 GPU 已停止。Host 重启后的未完成任务显示“中断”，需用户明确重新提交。

401/403、限流、模型不可见、损坏响应和超时均直接显示错误，不自动更换模型、服务或重试生图。返回 200 仍须通过文件格式、尺寸和透明像素验证；画面语义需要实际查看，模型文本不会声称已完成视觉检查。多参考图的保留效果还取决于模型与提示词，不保证逐像素一致。

图像任务旁路记录位于 `<storage>/cli/image-generation/`，原始产物位于既有 `<storage>/cli/artifacts/`。备份或迁移时同时保留这两个目录和会话数据库；恢复前停止应用。不要把含密钥的 Provider 配置或本地验收目录提交到仓库。

界面改版的验证记录见 [图像编辑器界面改版验收](image-editor-refresh-acceptance.md)。

## 构建与验收

使用仓库固定的 Node 24.14.0 和 pnpm 10.33.2，先完成官方 `pnpm bootstrap` 所需的运行资产准备。

```bash
pnpm build:image-workbench
pnpm test:image-generation:all
```

构建按顺序执行，禁止同时运行类型输出和打包：资产收集会对不同平台的同名文件校验哈希。内存较小的机器可设置 `NODE_OPTIONS=--max-old-space-size=2048`、`RAYON_NUM_THREADS=2`；全仓根类型检查可能需要 3072 MiB。CLI 类型检查使用 `pnpm --dir apps/zcode-cli typecheck --concurrency=1`。不发布下载站时使用本地压缩包；默认生成的下载索引包含占位域名，不能作为在线安装地址。部署下载站后可为构建命令提供 `--base-url`。

`test:image-generation:compatibility` 在设置 `ZCODE_IMAGE_TEST_BASELINE` 后连接已构建的官方基线 Host/前端，验证新旧两向互操作。

专项入口包括 `test:image-generation`（契约/服务/资源）、`test:image-generation:long`（真实等待 310 秒）、`test:image-generation:web`、`test:image-generation:desktop`、`test:image-generation:cli`、`test:image-generation:layout`（中文画布与面板布局）。自动 UI 测试使用本机模拟服务和全新隔离目录，保存 DOM、请求、下载及截图；文件选择器和桌面保存对话框由自动化提供路径，文件读写与哈希核对真实执行。

局部重绘实测入口为 `node --import tsx scripts/verify-image-repaint-live.ts --connection PRIVATE.json --reference SOURCE.png --mask MASK.png --prompt TEXT --output NEW_DIRECTORY`。输出目录必须尚不存在，以免误重试。脚本校验选区外每个 RGBA 像素并记录选区内变化数量；生成内容仍需人工视觉核对。本次结果见 [局部重绘验收记录](image-generation-v2-acceptance.md)。

对发行包运行相同 UI 测试：`ZCODE_IMAGE_TEST_DISTRIBUTION` 指向解压后的 `zcode` 目录，`ZCODE_IMAGE_TEST_ELECTRON` 指向桌面可执行文件。`ZCODE_IMAGE_TEST_BROWSER` 可选择已安装的浏览器通道，默认 Chrome。测试运行结果保存到 `.evidence/automated/`。

真实多参考图验收脚本为 `node --import tsx scripts/verify-image-generation-live.ts --connection PRIVATE.json --output OUTPUT --reference FILE ...`，须提供五个参考图路径。私有连接文件包含 `providerId`、`baseUrl`、`apiKey` 和可选 `model`，不得提交。脚本串行运行 512/1024 × 1/3/5 参考图及横纵构图，可用重复的 `--case` 选择场景；它只记录参数与哈希，不保存密钥。完成文件需逐张视觉核对。上次记录中有失败或不确定结果时脚本拒绝自动重放。

真实 TUI 可通过 `scripts/capture-image-tui.mjs` 记录实际终端字节（使用 Node PTY，支持传入 `--session` 恢复），再通过 `scripts/render-image-tui.mjs` 生成可查看的终端画面。两个脚本的 `--help` 提供参数格式；环境文件仅接受 ZCODE\_ 选项，不替换系统 HOME。录制文件含会话内容，保留在本地验收目录。截图是终端字节回放，不是 Electron 或桌面系统对话框的截图替代品。

Windows/macOS 路径均使用 Node 标准路径 API，CLI 包收集对应的 TUI 资源，系统 Skill 同时进入 SEA 收集清单；目标操作系统、签名和安装运行仍需在相应机器验证。

## 跟进官方更新

`origin` 指向个人 fork，`upstream` 指向官方。保留 `main` 为官方基线；`custom/main` 是定制集成分支，功能分支为 `feat/qwen-image-workbench`。

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git switch custom/main
git merge main
```

重新 fork 时从目标官方版本建立新的定制分支，按顺序重放本功能提交。先查看 [规格](image-generation.md)，再检查注册点：共享协议能力与双版本 schema、Runtime 工具注册、Bootstrap 注入、V4 路由、共享 Workbench 入口、资源打包和定制数据入口。核心图像逻辑集中在独立模块中，不改 Agent 主循环或核心数据库表结构。

冲突解决后运行类型、Lint、架构检查及专项测试，最后重新构建并验收产物。缺少图像 Skill 只停用图像能力；不得以替换整个系统 Skill 包的方式规避合并。升级前保留备份与原分支，本项目不承诺任意未来版本零冲突。
