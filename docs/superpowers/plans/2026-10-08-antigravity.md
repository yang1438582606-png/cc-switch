# Antigravity CLI Quota Implementation Plan (Revised)

## 1. Goal
Provide real-time Antigravity quota querying directly within CC Switch via the official Google Authenticode-signed Antigravity CLI (`agy.exe`), displaying 5-hour and weekly remaining quotas across dynamic model groups, with an interactive console trigger for initial login.

## 2. Architecture & Design Decisions
- **Subprocess-based query**: Instead of reading sensitive OAuth files or intercepting local HTTP services/CSRF tokens, CC Switch spawns the official signed CLI helper on-demand:
  `agy.exe --print /usage --output-format json --log-file NUL --print-timeout 40s`
- **Child process isolation**:
  - `AGY_CLI_DISABLE_AUTO_UPDATE=true` set only in the child environment.
  - Windows `CREATE_NO_WINDOW` (0x08000000) for query execution, stdin closed (`Stdio::null()`), safe working directory.
  - Interactive login via `open_antigravity_cli` with `CREATE_NEW_CONSOLE` (0x00000010) allowing user authentication directly within the official CLI without credential interception.
- **Dedicated Sidebar Navigation**:
  - Registered as `antigravityQuota` in `src/lib/navigation.ts` and `src/components/shell/Sidebar.tsx`.
  - Dedicated page `src/components/antigravity/AntigravityQuotaPage.tsx` routed via `src/App.tsx`.
  - Reverted draft card insertions in `UsageDashboard.tsx` to maintain clean separation.
- **Dynamic Group & Window Normalization**:
  - Quota read from `command.data.groups[]`.
  - Model group names (e.g. Gemini Models, Claude & GPT Models) and buckets parsed dynamically.
  - Preserves unknown windows (e.g., custom/quarterly).
  - Validates `remaining_fraction` strictly within `0.0..=1.0`; missing or invalid values rendered as "未知" (never faked).
  - Formats reset times in the user's local timezone.
- **Helper Provisioning**:
  - Helper lookup order:
    1. `%LOCALAPPDATA%\cc-switch\tools\antigravity\agy.exe` (Primary dedicated location)
    2. `%LOCALAPPDATA%\agy\bin\agy.exe` (Official default installation path)
  - Verified binary provisioned from verified Google LLC Authenticode signed source (`38F30C7DD1ED808F5CF98FE2014DE3D30903035A4F0DF02D3EB72A9FF8993741`, ~181.5 MiB).

## 3. Implementation Steps Completed
- [x] Revert draft Antigravity code in `src/components/usage/UsageDashboard.tsx`.
- [x] Remove obsolete draft scripts and probe files (`scripts/antigravity-*.{ps1,mjs}`).
- [x] Implement safe Tauri backend command `query_antigravity_quota` and `open_antigravity_cli` in `src-tauri/src/commands/antigravity.rs`.
- [x] Register Tauri commands in `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`.
- [x] Add Rust unit tests in `src-tauri/src/commands/antigravity.rs`.
- [x] Add `"antigravityQuota"` to `GlobalPage` in `src/lib/navigation.ts`.
- [x] Add navigation item to `Sidebar.tsx` with `Gauge` icon and i18n support across 4 locales.
- [x] Create `src/components/antigravity/antigravityTypes.ts` with TypeScript types and pure formatter functions.
- [x] Create dedicated `src/components/antigravity/AntigravityQuotaPage.tsx` matching native dark theme, headers, manual refresh, login action, and error states.
- [x] Route dedicated page in `src/App.tsx`.
- [x] Write frontend vitest unit tests in `src/components/antigravity/AntigravityQuotaPage.test.tsx` (7 tests, all passing).
- [x] Run `pnpm typecheck` (passed with 0 errors).
- [x] Run `pnpm build:renderer` (Vite production build passed in ~23s).
- [x] Run real live end-to-end integration query against provisioned `agy.exe` (SUCCESS, 2 groups, 4 buckets parsed).
- [x] Verify cargo/rustc environment status (absent on system; document packaging limitation).
