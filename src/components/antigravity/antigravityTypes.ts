export interface AntigravityBucket {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  window?: string | null;
  remainingPercent: number | null;
  resetTime?: string | null;
}

export interface AntigravityGroup {
  name?: string | null;
  description?: string | null;
  buckets: AntigravityBucket[];
}

export interface AntigravityQuotaData {
  account: string | null;
  source: string;
  updatedAt: string;
  groups: AntigravityGroup[];
}

/**
 * 格式化剩余百分比。
 * 必须严格在 0..=100 范围内，无效或缺失值显示“未知”，严禁伪造 0 或 100。
 */
export function formatPercent(value: number | null | undefined): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    return "未知";
  }
  return `${value.toFixed(2)}%`;
}

/**
 * 格式化重置时间为本地时区时间。
 */
export function formatResetTime(isoTime: string | null | undefined): string {
  if (!isoTime) return "未知";
  const parsed = Date.parse(isoTime);
  if (Number.isNaN(parsed)) return "未知";
  return new Date(parsed).toLocaleString();
}

/**
 * 获取配额周期的友好显示标签。
 * 保留未知或动态周期语义，不强制硬编码。
 */
export function getWindowLabel(window: string | null | undefined): string {
  if (!window) return "未知周期";
  const w = window.toLowerCase().trim();
  if (w === "5h" || w === "5-hour" || w === "five_hour") return "5 小时配额";
  if (w === "weekly" || w === "week" || w === "7d") return "每周配额";
  if (w === "daily" || w === "day" || w === "24h") return "每日配额";
  return `${window} 配额`;
}
