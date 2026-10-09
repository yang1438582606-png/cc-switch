//! On-demand quota querying via the official unmodified Antigravity CLI (`agy.exe`).
//!
//! Security & Safety:
//! - Subprocess-based query only; no local credential file reads, no direct Google requests.
//! - Closed stdin, explicit safe cwd, CREATE_NO_WINDOW flag on Windows.
//! - Environment variable `AGY_CLI_DISABLE_AUTO_UPDATE=true` set ONLY for child process.
//! - Active concurrent pipe streaming with true 1MB upper limit to prevent pipe buffer deadlock.
//! - Error messages are sanitized: no raw stdout/stderr, tokens, or credential leaks.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityBucket {
    pub id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub window: Option<String>,
    pub remaining_percent: Option<f64>,
    pub reset_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityGroup {
    pub name: Option<String>,
    pub description: Option<String>,
    pub buckets: Vec<AntigravityBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityQuotaResult {
    pub account: Option<String>,
    pub source: String,
    pub updated_at: String,
    pub groups: Vec<AntigravityGroup>,
}

/// Resolves the path to the official `agy.exe` executable.
/// 1. Primary: `%LOCALAPPDATA%\cc-switch\tools\antigravity\agy.exe`
/// 2. Fallback: `%LOCALAPPDATA%\agy\bin\agy.exe`
pub fn resolve_antigravity_cli_path() -> Result<PathBuf, String> {
    let local_app_data = dirs::data_local_dir()
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from));

    if let Some(base) = local_app_data {
        let primary = base
            .join("cc-switch")
            .join("tools")
            .join("antigravity")
            .join("agy.exe");
        if primary.is_file() {
            return Ok(primary);
        }

        let fallback = base.join("agy").join("bin").join("agy.exe");
        if fallback.is_file() {
            return Ok(fallback);
        }
    }

    Err("未检测到 Antigravity CLI 工具 (agy.exe)，请将其放置于 %LOCALAPPDATA%\\cc-switch\\tools\\antigravity\\agy.exe".to_string())
}

/// Sanitizes process output and error details into safe, user-friendly messages.
/// Raw output/stderr must NEVER be shown or logged to prevent leaking any tokens or private data.
pub fn sanitize_cli_error(err_or_out: &str, exit_code: Option<i32>) -> String {
    let lower = err_or_out.to_lowercase();
    if lower.contains("authenticat")
        || lower.contains("not logged")
        || lower.contains("sign in")
        || lower.contains("login")
        || lower.contains("unauthorized")
        || lower.contains("auth-required")
    {
        "需要登录 Antigravity CLI：请先在终端中完成账号登录".to_string()
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "额度查询超时，请稍后重试".to_string()
    } else if exit_code == Some(0) {
        "CLI 返回的额度数据无效或缺少配额信息".to_string()
    } else {
        "Antigravity CLI 查询失败".to_string()
    }
}

/// Masks an email address safely (e.g. `user@example.com` -> `u***@example.com`).
pub fn mask_account(email: &str) -> Option<String> {
    let trimmed = email.trim();
    let (name, domain) = trimmed.split_once('@')?;
    if name.is_empty() || domain.is_empty() {
        return None;
    }
    let first = name.chars().next().unwrap_or('*');
    Some(format!("{first}***@{domain}"))
}

/// Parses the official `/usage` JSON output structure into normalized quota data.
///
/// Quota source is `command.data.groups[]` with dynamic keys.
/// Missing or out-of-range fractions are converted to `None` (never faked as 0 or 100).
pub fn normalize_cli_quota(summary: &Value) -> Result<AntigravityQuotaResult, String> {
    let groups = summary
        .pointer("/command/data/groups")
        .or_else(|| summary.pointer("/data/groups"))
        .or_else(|| summary.pointer("/groups"))
        .and_then(Value::as_array)
        .ok_or_else(|| "CLI 返回的额度数据无效或缺少配额信息".to_string())?;

    if groups.is_empty() {
        return Err("CLI 返回的额度数据无效或缺少配额信息".to_string());
    }

    let parsed_groups: Vec<AntigravityGroup> = groups
        .iter()
        .map(|group| {
            let name = group
                .get("name")
                .or_else(|| group.get("displayName"))
                .and_then(Value::as_str)
                .map(String::from);

            let description = group
                .get("description")
                .and_then(Value::as_str)
                .map(String::from);

            let buckets = group
                .get("buckets")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .map(|bucket| {
                            let id = bucket
                                .get("id")
                                .or_else(|| bucket.get("bucket_id"))
                                .or_else(|| bucket.get("bucketId"))
                                .and_then(Value::as_str)
                                .map(String::from);

                            let b_name = bucket
                                .get("name")
                                .or_else(|| bucket.get("displayName"))
                                .and_then(Value::as_str)
                                .map(String::from);

                            let b_desc = bucket
                                .get("description")
                                .and_then(Value::as_str)
                                .map(String::from);

                            let window = bucket
                                .get("window")
                                .and_then(Value::as_str)
                                .map(String::from);

                            // Only accept finite fractions in range 0.0..=1.0
                            let remaining_fraction = bucket
                                .get("remaining_fraction")
                                .or_else(|| bucket.get("remainingFraction"))
                                .or_else(|| bucket.pointer("/remaining/remainingFraction"))
                                .and_then(Value::as_f64)
                                .filter(|v| v.is_finite() && (0.0..=1.0).contains(v));

                            let remaining_percent = remaining_fraction.map(|f| f * 100.0);

                            let reset_time = bucket
                                .get("reset_time")
                                .or_else(|| bucket.get("resetTime"))
                                .and_then(Value::as_str)
                                .map(String::from);

                            AntigravityBucket {
                                id,
                                name: b_name,
                                description: b_desc,
                                window,
                                remaining_percent,
                                reset_time,
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            AntigravityGroup {
                name,
                description,
                buckets,
            }
        })
        .collect();

    // Check if CLI output provides any account email safely
    let account = summary
        .get("account")
        .or_else(|| summary.pointer("/command/data/account"))
        .or_else(|| summary.pointer("/data/account"))
        .and_then(Value::as_str)
        .and_then(mask_account);

    Ok(AntigravityQuotaResult {
        account,
        source: "Antigravity CLI (/usage)".to_string(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        groups: parsed_groups,
    })
}

#[tauri::command]
pub async fn query_antigravity_quota() -> Result<AntigravityQuotaResult, String> {
    #[cfg(not(windows))]
    {
        Err("Antigravity CLI 额度查询目前仅支持 Windows".to_string())
    }
    #[cfg(windows)]
    {
        windows::query().await
    }
}

#[tauri::command]
pub async fn open_antigravity_cli() -> Result<(), String> {
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".to_string())
    }
    #[cfg(windows)]
    {
        windows::open_cli()
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::io::Read;
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const CREATE_NEW_CONSOLE: u32 = 0x00000010;
    const MAX_OUTPUT_BYTES: u64 = 1024 * 1024; // 1 MB hard memory limit

    #[link(name = "kernel32")]
    extern "system" {
        fn PeekNamedPipe(
            pipe: *mut std::ffi::c_void,
            buffer: *mut std::ffi::c_void,
            size: u32,
            read: *mut u32,
            available: *mut u32,
            remaining: *mut u32,
        ) -> i32;
    }

    // Only read bytes already buffered in the pipe. No blocking reader threads:
    // descendants retaining a write handle cannot keep the query alive past its deadline.
    fn drain<T: Read + AsRawHandle>(pipe: &mut T, output: &mut Vec<u8>) -> Result<(), String> {
        let mut available = 0u32;
        let ok = unsafe {
            PeekNamedPipe(pipe.as_raw_handle(), std::ptr::null_mut(), 0,
                std::ptr::null_mut(), &mut available, std::ptr::null_mut())
        };
        if ok == 0 {
            if std::io::Error::last_os_error().raw_os_error() == Some(109) {
                return Ok(()); // ERROR_BROKEN_PIPE: writer closed.
            }
            return Err("读取 CLI 输出失败".into());
        }
        let mut buffer = [0u8; 8192];
        let count = (available as usize).min(buffer.len());
        if count > 0 {
            let read = pipe.read(&mut buffer[..count]).map_err(|_| "读取 CLI 输出失败")?;
            if output.len() + read > MAX_OUTPUT_BYTES as usize {
                return Err("CLI 输出超出大小限制".into());
            }
            output.extend_from_slice(&buffer[..read]);
        }
        Ok(())
    }

    pub fn open_cli() -> Result<(), String> {
        let agy_path = resolve_antigravity_cli_path()?;
        let cwd = agy_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        Command::new(&agy_path)
            .current_dir(cwd)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|_| "无法启动 Antigravity CLI 交互终端".to_string())?;
        Ok(())
    }

    pub async fn query() -> Result<AntigravityQuotaResult, String> {
        let agy_path = resolve_antigravity_cli_path()?;
        let cwd = agy_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        tauri::async_runtime::spawn_blocking(move || {
            let mut cmd = Command::new(&agy_path);
            cmd.args([
                "--print",
                "/usage",
                "--output-format",
                "json",
                "--log-file",
                "NUL",
                "--print-timeout",
                "40s",
            ])
            .current_dir(&cwd)
            .env("AGY_CLI_DISABLE_AUTO_UPDATE", "true")
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

            let mut child = cmd
                .spawn()
                .map_err(|_| "无法启动 Antigravity CLI 子进程".to_string())?;

            // Drain both pipes on each poll, before checking process completion.
            let mut stdout_handle = child
                .stdout
                .take()
                .ok_or_else(|| "无法获取 stdout 管道".to_string())?;
            let mut stderr_handle = child
                .stderr
                .take()
                .ok_or_else(|| "无法获取 stderr 管道".to_string())?;

            let mut stdout_bytes = Vec::new();
            let mut stderr_bytes = Vec::new();
            let start = std::time::Instant::now();
            let timeout = Duration::from_secs(50);
            let status = loop {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err("额度查询超时，请稍后重试".to_string());
                }
                let before = stdout_bytes.len() + stderr_bytes.len();
                if let Err(error) = drain(&mut stdout_handle, &mut stdout_bytes)
                    .and_then(|_| drain(&mut stderr_handle, &mut stderr_bytes)) {
                    let _ = child.kill();
                    return Err(error);
                }
                match child.try_wait() {
                    Ok(Some(status)) => {
                        // Continue until all buffered bytes have been consumed, not until EOF.
                        if stdout_bytes.len() + stderr_bytes.len() == before {
                            break status;
                        }
                    }
                    Ok(None) => {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => {
                        let _ = child.kill();
                        return Err("Antigravity CLI 运行异常".to_string());
                    }
                }
            };

            let stdout_str = String::from_utf8_lossy(&stdout_bytes);
            let stderr_str = String::from_utf8_lossy(&stderr_bytes);

            if !status.success() {
                let combined = format!("{stdout_str} {stderr_str}");
                return Err(sanitize_cli_error(&combined, status.code()));
            }

            let parsed: Value = serde_json::from_str(&stdout_str).map_err(|_| {
                let combined = format!("{stdout_str} {stderr_str}");
                sanitize_cli_error(&combined, status.code())
            })?;

            normalize_cli_quota(&parsed)
        })
        .await
        .map_err(|_| "配额查询任务执行失败".to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_normalize_valid_cli_output() {
        let fixture = json!({
            "conversation_id": "",
            "status": "SUCCESS",
            "command": {
                "name": "usage",
                "data": {
                    "groups": [
                        {
                            "name": "Gemini Models",
                            "description": "Models within this group: Gemini Flash, Gemini Pro",
                            "buckets": [
                                {
                                    "id": "gemini-weekly",
                                    "name": "Weekly Limit Remaining",
                                    "window": "weekly",
                                    "remaining_fraction": 0.9955878,
                                    "reset_time": "2026-10-15T06:18:47Z"
                                },
                                {
                                    "id": "gemini-5h",
                                    "name": "Five Hour Limit Remaining",
                                    "window": "5h",
                                    "remaining_fraction": 0.9735268,
                                    "reset_time": "2026-10-08T11:18:47Z"
                                }
                            ]
                        },
                        {
                            "name": "Claude and GPT models",
                            "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
                            "buckets": [
                                {
                                    "id": "3p-weekly",
                                    "name": "Weekly Limit Remaining",
                                    "window": "weekly",
                                    "remaining_fraction": 1.0,
                                    "reset_time": "2026-10-15T09:46:17Z"
                                }
                            ]
                        }
                    ]
                }
            }
        });

        let result = normalize_cli_quota(&fixture).expect("should parse valid quota");
        assert_eq!(result.groups.len(), 2);
        assert_eq!(result.groups[0].name.as_deref(), Some("Gemini Models"));
        assert_eq!(result.groups[0].buckets.len(), 2);
        assert!((result.groups[0].buckets[0].remaining_percent.unwrap() - 99.55878).abs() < 1e-4);
        assert_eq!(result.groups[0].buckets[0].window.as_deref(), Some("weekly"));
        assert_eq!(result.groups[1].buckets[0].remaining_percent, Some(100.0));
        assert!(result.account.is_none());
        assert_eq!(result.source, "Antigravity CLI (/usage)");
    }

    #[test]
    fn test_missing_and_out_of_bounds_fractions_are_none() {
        let fixture = json!({
            "command": {
                "name": "usage",
                "data": {
                    "groups": [
                        {
                            "name": "Experimental Models",
                            "buckets": [
                                {
                                    "id": "b1",
                                    "window": "weekly",
                                    "remaining_fraction": 1.2 // out of bounds > 1.0
                                },
                                {
                                    "id": "b2",
                                    "window": "5h",
                                    "remaining_fraction": -0.1 // out of bounds < 0.0
                                },
                                {
                                    "id": "b3",
                                    "window": "unknown_future_window", // preserve unknown windows
                                    "remaining_fraction": null // missing/null
                                },
                                {
                                    "id": "b4",
                                    "window": "daily",
                                    "remaining_fraction": 0.0 // boundary 0.0
                                }
                            ]
                        }
                    ]
                }
            }
        });

        let result = normalize_cli_quota(&fixture).expect("should parse");
        let buckets = &result.groups[0].buckets;
        assert_eq!(buckets[0].remaining_percent, None);
        assert_eq!(buckets[1].remaining_percent, None);
        assert_eq!(buckets[2].remaining_percent, None);
        assert_eq!(buckets[2].window.as_deref(), Some("unknown_future_window"));
        assert_eq!(buckets[3].remaining_percent, Some(0.0));
    }

    #[test]
    fn test_empty_or_missing_groups_error() {
        let empty_groups = json!({
            "command": { "name": "usage", "data": { "groups": [] } }
        });
        assert!(normalize_cli_quota(&empty_groups).is_err());

        let no_groups = json!({
            "command": { "name": "usage", "data": {} }
        });
        assert!(normalize_cli_quota(&no_groups).is_err());

        let top_level_usage_only = json!({
            "usage": { "input_tokens": 100, "total_tokens": 200 }
        });
        assert!(normalize_cli_quota(&top_level_usage_only).is_err());
    }

    #[test]
    fn test_mask_account() {
        assert_eq!(mask_account("john.doe@gmail.com"), Some("j***@gmail.com".to_string()));
        assert_eq!(mask_account("a@b.com"), Some("a***@b.com".to_string()));
        assert_eq!(mask_account("invalid-email"), None);
        assert_eq!(mask_account("@domain.com"), None);
    }

    #[test]
    fn test_sanitize_cli_error() {
        assert_eq!(
            sanitize_cli_error("Error: Please authenticate before using agy", Some(1)),
            "需要登录 Antigravity CLI：请先在终端中完成账号登录"
        );
        assert_eq!(
            sanitize_cli_error("Not logged in. Run agy login", Some(1)),
            "需要登录 Antigravity CLI：请先在终端中完成账号登录"
        );
        assert_eq!(
            sanitize_cli_error("Operation timed out after 40s", Some(1)),
            "额度查询超时，请稍后重试"
        );
        assert_eq!(
            sanitize_cli_error("malformed json output", Some(0)),
            "CLI 返回的额度数据无效或缺少配额信息"
        );
        assert_eq!(
            sanitize_cli_error("unexpected crash", Some(2)),
            "Antigravity CLI 查询失败"
        );
    }
}
