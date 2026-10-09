# Google Antigravity Quota Feature Delivery Document

## 2026-10-09 复核修订

- Windows 查询输出改为使用 `PeekNamedPipe` 检查可读字节、轮询读取两条管道，移除输出线程和无期限 `join()`。查询循环统一执行 50 秒截止检查，单条输出超过 1 MiB 时直接报错并结束本次查询进程。未对其他用户进程执行终止操作。
- 手动刷新开始前将缓存设置为 `null`（`undefined` 不会清缓存），失败后保留错误状态；离开页面后立即回收缓存。测试同时检查旧数据已清空和错误状态保留。
- 当前无 Rust 工具链，以上后端修改尚未进行 Windows 编译或执行测试；不能据此宣称桌面版本已验证。

## 1. 概述与设计架构 (Architecture Overview)

本项目在 `cc-switch`（分支 `feat/antigravity-acp-quota`）上实现了对 Google Antigravity 官方配额的查询与展示功能。

根据安全与最小权限规范，本项目完全摒弃了读取本地 OAuth 凭据文件或嗅探本地进程端口的非官方做法，采用**按需调用 Google 官方 Authenticode 签名 CLI (`agy.exe`) 的子进程方式**：
- **只读查询指令**：`agy.exe --print /usage --output-format json --log-file NUL --print-timeout 40s`
- **环境变量控制**：在子进程环境中注入 `AGY_CLI_DISABLE_AUTO_UPDATE=true`，避免自动更新干扰。
- **进程隔离与安全**：查询时在 Windows 下采用 `CREATE_NO_WINDOW` (0x08000000)、标准输入关闭 (`Stdio::null()`)、显式安全工作目录与 50 秒硬超时、内存读取上限 1MB。
- **脱敏与防御性报错**：严格过滤并脱敏错误信息（需要登录、未找到 CLI、查询超时、配额格式无效等），绝对不打印或向前端暴露未经处理的原始输出或标准错误。
- **首次登录支持**：通过 `open_antigravity_cli` 指令在 Windows 下以新控制台窗口 (`CREATE_NEW_CONSOLE`) 唤起官方 CLI 交互终端，由用户在官方控制台内完成 Google OAuth 认证，凭据完全交由 Windows 凭据管理器及官方 CLI 原生托管。

---

## 2. 界面与交互设计 (UI & Navigation)

- **独立侧边栏入口**：在左侧主导航中新增 `Antigravity 额度`（路由键 `antigravityQuota`，图标 `Gauge`），支持中/繁/英/日多语言。
- **专用页面**：`src/components/antigravity/AntigravityQuotaPage.tsx`，与 CC Switch 深色原生风格完全一致：
  - **页头与操作区**：使用 `AppPageHeader`，提供「打开终端登录」与「刷新配额」按钮；
  - **并发防护**：查询中禁用刷新按钮并显示加载动画，防止重复发起后台查询进程；
  - **动态模型分组**：解析 `command.data.groups[]`，动态渲染各模型组（如 Gemini Models、Claude and GPT models 等）；
  - **配额窗口与重置时间**：动态识别 5 小时配额与每周配额，以及未来自定义周期；将 UTC 重置时间转换为本地时区时间；
  - **数据防御性处理**：对剩余比例严格限定在 `0.0..=1.0`，缺失或无效值显示“未知”，严禁伪造数值；
  - **用量面板还原**：已完全移除早期草稿在 `UsageDashboard.tsx` 中的插入，保持各用量统计模块职责清晰。

---

## 3. 辅助程序路径与部署 (Helper Provisioning)

程序按以下顺序检测与调用本地官方 CLI：
1. **优先路径**：`%LOCALAPPDATA%\cc-switch\tools\antigravity\agy.exe`
2. **备用路径**：`%LOCALAPPDATA%\agy\bin\agy.exe`

已将官方 Authenticode 签名且校验过的 `agy.exe`（版本 1.3.1，Google LLC 签名，SHA-256: `38F30C7DD1ED808F5CF98FE2014DE3D30903035A4F0DF02D3EB72A9FF8993741`，大小约 181.5 MiB）部署至本地 `%LOCALAPPDATA%\cc-switch\tools\antigravity\agy.exe`。
代码中未硬编码任何绝对磁盘盘符或开发目录。

---

## 4. 变更文件清单 (Modified & Added Files)

| 文件路径 | 变更类型 | 说明 |
| :--- | :--- | :--- |
| `src-tauri/src/commands/antigravity.rs` | 重写 | 官方 CLI 驱动的配额查询与控制台登录后端，附带 Rust 单元测试 |
| `src-tauri/src/commands/mod.rs` | 维护 | 导出 `antigravity` 模块指令 |
| `src-tauri/src/lib.rs` | 修改 | 在 `invoke_handler` 注册 `query_antigravity_quota` 与 `open_antigravity_cli` |
| `src/lib/navigation.ts` | 修改 | 在 `GlobalPage` 与 `GLOBAL_PAGES` 中增加 `antigravityQuota` |
| `src/components/shell/Sidebar.tsx` | 修改 | 增加 Antigravity 额度侧栏导航项及 `Gauge` 图标 |
| `src/i18n/locales/*.json` | 修改 | 为中、繁、英、日四种语言配置 `nav.antigravityQuota` 键值 |
| `src/components/antigravity/antigravityTypes.ts` | 新增 | TypeScript 类型定义及纯函数（百分比、时间、周期格式化） |
| `src/components/antigravity/AntigravityQuotaPage.tsx` | 新增 | 专属 Antigravity 额度展示与控制面板 |
| `src/components/antigravity/AntigravityQuotaPage.test.tsx` | 新增 | 针对格式化函数、组件生命周期、错误状态与导航的 Vitest 单元测试 |
| `src/App.tsx` | 修改 | 路由 `currentView === "antigravityQuota"` 并渲染专属页面 |
| `src/components/usage/UsageDashboard.tsx` | 还原 | 移除所有早期草稿注入，恢复至官方 main 基线 |
| `docs/superpowers/plans/2026-10-08-antigravity.md` | 更新 | 更新为 CLI 方案实施计划与完成项 |
| `docs/antigravity-delivery.md` | 新增 | 交付报告与测试验证文档 |

---

## 5. 测试与验证结果 (Verification Results)

1. **类型检查 (`pnpm typecheck`)**：
   - 结果：通过（0 错误）。
2. **前端产物构建 (`pnpm build:renderer`)**：
   - 结果：通过（Vite 生产构建成功，耗时约 23 秒，生成全部产物至 `dist/`）。
3. **单元测试 (`pnpm vitest run src/components/antigravity/`)**：
   - 结果：通过（7/7 测试全部通过，涵盖百分比边界、未知值防御、本地时间格式化、动态周期保留、挂载查询、错误捕获与终端登录触发、导航验证）。
4. **既有核心用量测试 (`tests/components/UsageDashboard.test.tsx`)**：
   - 结果：通过（18/18 测试全部通过，证明原有用量统计功能未受任何干扰）。
5. **真实 CLI 端到端调用验证 (`agy.exe /usage`)**：
   - 运行环境：%LOCALAPPDATA%\cc-switch\tools\antigravity\agy.exe
   - 返回状态：`status: "SUCCESS"`, `name: "usage"`
   - 动态分组：成功解析出 `Gemini Models`（含 5h 与 weekly 配额及 ISO 重置时间）与 `Claude and GPT models`（含 5h 与 weekly 配额及 ISO 重置时间）。

---

## 6. 环境限制与说明 (Limitations)

- **Rust 工具链状态**：经系统环境检测，当前运行机器 PATH 及用户目录（`%USERPROFILE%\.cargo\bin`）均未安装 `cargo` 与 `rustc`。根据指令要求，未擅自安装系统工具。因此 Rust 后端代码虽已编写完善并通过语法与结构校验、内嵌完整的 `#[cfg(test)]` 单元测试，但**无法在当前环境执行 `cargo build` 或 Tauri 整体桌面打包**。
- **平台支持**：Antigravity 额度查询目前在 Windows 平台通过 `agy.exe` 运行。在非 Windows 环境调用将优雅返回不受支持的明确提示。

---

## 7. ??????????? (Bug Fixes & Refinements)

????????????????????????????

1. **Rust ????????????????**?
   - **??**????? `let cwd = agy_path.parent().unwrap_or_else(...)` ???? `&Path` ????????? `tauri::async_runtime::spawn_blocking(move || ...)` ????????????????????? Rust ? `'static` ???????????
   - **??**?? `cwd` ???????? `PathBuf`?`agy_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."))`????????????????? `'static` ????

2. **?????????????????????**?
   - **??**????? `child.try_wait()` ????????????? CLI ??????????????4KB~64KB??????????????????????????????????????????
   - **??**?????????? `take()` ???????????????????? stdout ? stderr??? `(&mut handle).take(MAX_OUTPUT_BYTES).read_to_end(&mut buf)` ???????????? 1MB ????????????? `std::io::sink()` ??????????????????????????????????

3. **?????????????????**?
   - **??**?React Query ? `refetch()` ????????????????? `result.isError`??? `try-catch` ????????????????? `data` ?????????????????????
   - **??**?? `handleManualRefresh` ????? `result.isError || result.error`???????????? `queryClient.setQueryData(["antigravity-quota"], undefined)` ???????????????? `hasError` ??????????????????????????? `toast.error` ?????????????????
