# Qwen 高分辨率参考图容量验收

日期：2026-10-06。此轮为当前 A40 部署验证 ZCode 可采用的统一参考图上限，覆盖全部七种最大画幅、不同参考图尺寸/比例、连续张数及上限复测；主动探索更高一档，并由用户确认服务端 OOM、手动恢复。

## 结论与适用条件

| 输出像素面积   | 常见方形尺寸                   | ZCode 参考图总数上限 |
| -------------- | ------------------------------ | -------------------: |
| ≤ 2,359,296    | 512、1024、1280、1536          |                    5 |
| ≤ 3,211,264    | 1792×1792                      |                    3 |
| 更大的合法尺寸 | 2048×2048 及六种非方形最大尺寸 |                    2 |

数量包含编辑目标；自动加入的 `parentId` 只算一次。局部重绘以选区引导图替换目标，蒙版本身不额外占名额。横竖图按宽×高分档，纯文生图沿用原来的尺寸范围。

- 1536 方形五图成功；现有代理/ZCode 协议最多接收五图，本轮不增加这个协议上限。
- 1792 方形一至三图成功，四图导致 OOM、服务退出。因此该档不接受四图及以上。
- 七种最大画幅一图、双图均成功；最大像素面积的 2400×1792 三图导致 OOM、服务退出。因此整个高分辨率档采用共同的双图上限，不能统一放宽到三图。

这是已验证部署与参数下的准入范围，不是对任意硬件或输入的无条件显存保证。未逐个穷尽所有 32 像素步长尺寸、每种画幅的独立物理极限、极长提示词或 CFG > 1；其它细分尺寸使用所在档位的统一限制。不同 GPU、卸载策略、动态 batching 或其它显存占用需要重新验证。

## 环境与测量

用户确认：单张 A40 48GB、BF16、`performance-mode=manual`、`text_encoder=layerwise-offload`、关闭动态 batching。服务元数据实际返回 `QwenImage21Pipeline`、单 GPU、DiT/VAE BF16、SGLang `0.5.21.dev367+ge332e1b84`。每次恢复后重新检查健康和版本，没有切换模型或启动配方。

所有测试串行执行，`n=1`、40 步、CFG 1、CPU RNG、PNG/Base64、关闭 Cache-DiT。参考图包含五张不同的已有生成图片，以及派生的 2048 方形、4096×2304 横图、2304×4096 竖图；复测改变种子及参考图集合。每个成功响应都解码并校验尺寸、格式、SHA-256，记录推理/端到端耗时和请求后的 `/health`。

`peak_memory_mb` 虽然名字包含 MB，实际是 **MiB 单位的 PyTorch 峰值 reserved memory**，包含缓存，不是峰值 allocated memory，也不是 NVML 的整卡空闲显存。[对应版本的 GPU worker 实现](https://github.com/sgl-project/sglang/blob/e332e1b84/python/sglang/multimodal_gen/runtime/managers/gpu_worker.py)

早期使用 46,000 MiB 作为审查停测线，得到较保守的候选值。用户确认可以手动恢复后，探索阶段使用 49,000 MiB 的停测线，并实际测试更高张数。**这些线是试验控制条件，不是硬件上限或最终准入公式。** 最终规则取连续成功的数量范围，并用更高数量的实际 OOM 反例限定共同上限，没有把超过初始筛选线等同于 OOM。

上游会把每张参考图按输出像素面积重新缩放并保留比例，因此只缩小上传文件不能可靠减少 GPU 工作量。[本轮对应版本的预处理实现](https://github.com/sgl-project/sglang/blob/e332e1b84/python/sglang/multimodal_gen/runtime/pipelines_core/stages/model_specific_stages/qwen_image21.py#L129)

## 实际 GPU 结果

可机器读取的记录见 [完整数据](image-generation-capacity-evidence.json)，包括输入尺寸/哈希、种子、输出尺寸/哈希、显存、耗时、服务健康及故障恢复。原图和原始日志保留在本地忽略目录 `.evidence/qwen-capacity/`。失败和未执行请求不计为成功。

本轮实际发出 **36 次** GPU 请求：**34 次成功、2 次受控边界 OOM**。两次故障后均由用户恢复，最后健康检查为 `ok`。当前规则允许全部 34 个成功请求，并在网络前拦截两个已确认 OOM 的组合。

| 用例                         | 参考图 | 上报峰值 MiB | 端到端秒 | 结果                 | 当前策略允许 |
| ---------------------------- | -----: | -----------: | -------: | -------------------- | ------------ |
| 1280x1280-5-baseline         |      5 |        44150 |    92.09 | succeeded / ok       | 是           |
| 1536x1536-3-baseline         |      3 |        44014 |   122.64 | succeeded / ok       | 是           |
| 1792x1792-2-baseline         |      2 |        46498 |   164.83 | succeeded / ok       | 是           |
| 1536x1536-4-boundary         |      4 |        44894 |   142.31 | succeeded / ok       | 是           |
| 1792x1792-1-boundary         |      1 |        38238 |   129.99 | succeeded / ok       | 是           |
| 1792x1792-3-boundary         |      3 |        45924 |   198.68 | succeeded / ok       | 是           |
| 2048x2048-1-boundary         |      1 |        44896 |   193.12 | succeeded / ok       | 是           |
| 2400x1792-1-ratio            |      1 |        44462 |   200.62 | succeeded / ok       | 是           |
| 1792x2400-1-ratio            |      1 |        44464 |   201.65 | succeeded / ok       | 是           |
| 2528x1696-1-ratio            |      1 |        44414 |   200.17 | succeeded / ok       | 是           |
| 1696x2528-1-ratio            |      1 |        44414 |   200.16 | succeeded / ok       | 是           |
| 2752x1536-1-ratio            |      1 |        43874 |   196.82 | succeeded / ok       | 是           |
| 1536x2752-1-ratio            |      1 |        43710 |   195.67 | succeeded / ok       | 是           |
| 1280x1280-5-large-repeat     |      5 |        43376 |    95.70 | succeeded / ok       | 是           |
| 1536x1536-4-large-repeat     |      4 |        46770 |   144.82 | succeeded / ok       | 是           |
| 1536x1536-3-large-confirm    |      3 |        44012 |   122.29 | succeeded / ok       | 是           |
| 1792x1792-2-large-confirm    |      2 |        45556 |   164.65 | succeeded / ok       | 是           |
| 2048x2048-1-large-repeat     |      1 |        43642 |   194.71 | succeeded / ok       | 是           |
| 2400x1792-1-portrait-repeat  |      1 |        44442 |   205.57 | succeeded / ok       | 是           |
| 1792x1792-3-physical         |      3 |        45984 |   199.12 | succeeded / ok       | 是           |
| 1536x1536-5-physical         |      5 |        46880 |   165.82 | succeeded / ok       | 是           |
| 1792x1792-4-physical         |      4 |            — |    26.08 | failed / unavailable | 否，已超限   |
| 2048x2048-2-physical         |      2 |        44832 |   246.35 | succeeded / ok       | 是           |
| 2752x1536-2-physical         |      2 |        43846 |   255.59 | succeeded / ok       | 是           |
| 1536x2752-2-physical         |      2 |        43846 |   255.63 | succeeded / ok       | 是           |
| 2528x1696-2-physical         |      2 |        43984 |   260.47 | succeeded / ok       | 是           |
| 1696x2528-2-physical         |      2 |        43984 |   258.96 | succeeded / ok       | 是           |
| 2400x1792-2-physical         |      2 |        44000 |   262.63 | succeeded / ok       | 是           |
| 1792x2400-2-physical         |      2 |        44000 |   263.59 | succeeded / ok       | 是           |
| 2400x1792-3-physical         |      3 |            — |    29.01 | failed / unavailable | 否，已超限   |
| 1536x1536-1-verification     |      1 |        33396 |    83.47 | succeeded / ok       | 是           |
| 1536x1536-2-verification     |      2 |        38610 |   103.23 | succeeded / ok       | 是           |
| 1536x1536-5-verification     |      5 |        47258 |   163.48 | succeeded / ok       | 是           |
| 2048x2048-2-verification     |      2 |        45268 |   248.00 | succeeded / ok       | 是           |
| 2400x1792-2-verification     |      2 |        45322 |   261.69 | succeeded / ok       | 是           |
| 2048x2048-1-regional-adapter |      1 |        44886 |   191.22 | succeeded / ok       | 是           |

两次边界请求的 HTTP 正文均未暴露 CUDA 详情；客户端记录的是 HTTP 500 和健康检查不可用，OOM 原因由用户查看服务端日志确认。均在第一次失败后停止、保留记录，待用户重启和健康检查通过后才发出不同的后续请求，未自动重试失败组合。1792 四图已失败后没有再冲击五图；最高分辨率三图反例已否定统一三图限制，没有将其它未测三图组合标成 OOM。

历史参考（2026-09-22，来源 `LocalLLMProxy/docs/qwen-image-2.1-integration.md`）：1536 五图曾成功，上报峰值 47,258 MiB；1792 五图 OOM 并退出。这些旧结果不计入本轮成功或失败次数。

## 实际适配器与软件验证

2048×2048 局部重绘通过真实 LocalLLMProxy 与 ZCode Qwen 适配器执行：上游只收到一张参考图，峰值 44,886 MiB；选区外 **4,157,440** 个 RGBA 像素逐一完全相同，选区内 36,864 个像素中 36,753 个发生变化。实际查看确认出现白色五角星，选区内釉色/反光仍有变化。

- 55 项单测通过；1 项 310 秒长等待测试按默认配置跳过，本次没有改变 HTTP 超时实现。
- 新增覆盖各尺寸档、横竖面积、隐式父图、蒙版计数、精确边界的 multipart、超限时零 HTTP、旧任务读取和重复命令不重发。脚本的失败/缺少显存/停测线行为另有模拟测试，与实际 GPU OOM 分开记录。
- Web 与真实 Electron 检查动态上限、按钮和快捷键拦截；改变尺寸保留提示词和五张参考图，降低尺寸后成功提交一次。1536 档允许五图，1792/2048 档分别拦截超出三图/双图的草稿。
- 4 项既有 Web/Electron 编辑与中英文布局回归、2 项真实 CLI 测试通过；CLI 将容量错误回传模型，不发 Images POST。
- CLI/Web 压缩包与 Linux 打包应用均实际运行并复验；Electron 报告 `packaged: true`。测试截图实际查看。
- 根类型检查、CLI 27/27 类型检查、根 Lint（70 个既有 warning、0 error）、修改的 CLI 文件 Lint（0 warning/error）、格式及架构检查通过。
- CLI 全量 Lint 未通过：未修改的 `cli`、`telemetry`、`adapters`、`bootstrap` 等文件有既有 `max-lines` 问题。Windows/macOS 实机未验证。

共享策略位于 `packages/shared/src/image-generation.ts`。会话 owner 在接受新任务前检查，适配器在网络前再检查，UI 与工具 schema/Skill 使用相同规则；不把新的准入限制混进历史输入 schema。超限草稿保留原图与参数，不自动删图、降分辨率、切换服务或重试。
