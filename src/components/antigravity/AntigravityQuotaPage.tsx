import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  Gauge,
  RefreshCw,
  Terminal,
  AlertCircle,
  Clock,
  User,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type AntigravityQuotaData,
  formatPercent,
  formatResetTime,
  getWindowLabel,
} from "./antigravityTypes";

export function AntigravityQuotaPage() {
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const queryClient = useQueryClient();

  const {
    data,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<AntigravityQuotaData | null, Error>({
    queryKey: ["antigravity-quota"],
    queryFn: () => invoke<AntigravityQuotaData>("query_antigravity_quota"),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    staleTime: 60_000,
    gcTime: 0,
  });

  const handleOpenTerminalLogin = async () => {
    try {
      setOpeningTerminal(true);
      await invoke("open_antigravity_cli");
      toast.success("已打开 Antigravity CLI 终端窗口，请完成登录后点击刷新");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`无法打开终端: ${msg}`);
    } finally {
      setOpeningTerminal(false);
    }
  };

  const handleManualRefresh = async () => {
    if (isFetching) return;
    // `undefined` is a no-op in setQueryData. Clear before fetching so a failed
    // request retains its error state without retaining the previous account's data.
    queryClient.setQueryData(["antigravity-quota"], null);
    try {
      const result = await refetch();
      if (result.isError || result.error) {
        const msg =
          result.error instanceof Error
            ? result.error.message
            : String(result.error ?? "配额查询失败");
        toast.error(`配额查询失败: ${msg}`);
      } else {
        toast.success("配额已刷新");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`配额查询失败: ${msg}`);
    }
  };

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null;
  const isAuthRequired = errorMessage?.includes("登录") || errorMessage?.includes("认证");
  const hasError = Boolean(errorMessage);

  return (
    <>
      <AppPageHeader
        icon={<Gauge className="h-5 w-5" strokeWidth={1.5} />}
        title="Antigravity 额度"
        subtitle="基于官方 CLI 实时查询配额"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="quiet"
              size="regular"
              onClick={handleOpenTerminalLogin}
              disabled={openingTerminal}
            >
              <Terminal className="h-4 w-4" />
              <span>打开终端登录</span>
            </Button>
            <Button
              variant="solid"
              size="regular"
              onClick={handleManualRefresh}
              disabled={isFetching}
            >
              <RefreshCw
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
              <span>{isFetching ? "查询中..." : "刷新配额"}</span>
            </Button>
          </div>
        }
      />

      <div
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto scroll-stable px-6 pb-12 pt-4"
      >
        <div className="space-y-5">
          {/* 状态与账号信息横条：仅在无错误且有数据时显示，失败时不展示旧信息 */}
          {!hasError && data && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-4 py-3 text-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-fg-2">
                  <User className="h-4 w-4 text-fg-3" />
                  <span className="text-fg-3">账号：</span>
                  <span className="font-medium text-fg-1">
                    {data.account ?? "CLI 当前账号"}
                  </span>
                </div>
                <div className="h-3 w-px bg-border" />
                <div className="flex items-center gap-1.5 text-fg-2">
                  <Info className="h-4 w-4 text-fg-3" />
                  <span className="text-fg-3">来源：</span>
                  <span className="text-fg-1">官方 Antigravity CLI (/usage)</span>
                </div>
              </div>
              {data.updatedAt && (
                <div className="flex items-center gap-1.5 text-xs text-fg-3">
                  <Clock className="h-3.5 w-3.5" />
                  <span>最后更新：{formatResetTime(data.updatedAt)}</span>
                </div>
              )}
            </div>
          )}

          {/* 错误提示横幅 */}
          {errorMessage && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>查询失败：{errorMessage}</span>
              </div>
              <p className="text-xs text-destructive/80 leading-relaxed">
                {isAuthRequired
                  ? "请点击上方「打开终端登录」按钮，或在本地终端中运行 agy 交互命令完成 Google 账号登录授权后重试。"
                  : "请检查官方 CLI 工具是否已放置在正确目录，或网络连接是否正常。"}
              </p>
              <div className="pt-1 flex gap-2">
                {isAuthRequired && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenTerminalLogin}
                    disabled={openingTerminal}
                    className="border-destructive/30 text-destructive hover:bg-destructive/20"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    <span>立即终端登录</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualRefresh}
                  disabled={isFetching}
                  className="border-destructive/30 text-destructive hover:bg-destructive/20"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
                  <span>重试</span>
                </Button>
              </div>
            </div>
          )}

          {/* 加载占位 */}
          {isLoading && !data && (
            <div className="flex flex-col items-center justify-center py-16 text-fg-3 space-y-3">
              <RefreshCw className="h-8 w-8 animate-spin text-fg-3" />
              <p className="text-sm">正在通过官方 CLI 查询实时配额...</p>
            </div>
          )}

          {/* 配额卡片分组展示：仅在无错误时渲染，失败时不保留旧额度 */}
          {!hasError && data?.groups && data.groups.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
              {data.groups.map((group, groupIdx) => (
                <div
                  key={group.name ?? `group-${groupIdx}`}
                  className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-semibold text-fg-1">
                        {group.name ?? "未命名模型组"}
                      </h2>
                    </div>
                    {group.description && (
                      <p className="mt-1 text-xs text-fg-3 leading-relaxed">
                        {group.description}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3.5 pt-1">
                    {group.buckets.map((bucket, bIdx) => {
                      const percent = bucket.remainingPercent;
                      const hasPercent = percent !== null && percent !== undefined;
                      const isLow = hasPercent && percent < 20;

                      return (
                        <div
                          key={bucket.id ?? `bucket-${bIdx}`}
                          className="rounded-lg border border-border/60 bg-subtle/40 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5 font-medium text-fg-1">
                              <span>{bucket.name || getWindowLabel(bucket.window)}</span>
                              {bucket.window && (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 text-[10px] text-fg-3"
                                >
                                  {bucket.window}
                                </Badge>
                              )}
                            </div>
                            <span
                              className={cn(
                                "font-semibold text-sm",
                                !hasPercent && "text-fg-3",
                                hasPercent && isLow && "text-destructive",
                                hasPercent && !isLow && "text-fg-1"
                              )}
                            >
                              {formatPercent(percent)}
                            </span>
                          </div>

                          {/* 进度条指示 */}
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/80">
                            {hasPercent && (
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-300",
                                  isLow ? "bg-destructive" : "bg-primary"
                                )}
                                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                              />
                            )}
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-fg-3 pt-0.5">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              <span>重置：{formatResetTime(bucket.resetTime)}</span>
                            </div>
                          </div>

                          {bucket.description && (
                            <p className="text-[11px] text-fg-3/80 leading-normal">
                              {bucket.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 底部使用说明与安全提示 */}
          <div className="rounded-lg border border-border/60 bg-subtle/20 p-4 text-xs text-fg-3 space-y-2">
            <div className="flex items-center gap-1.5 font-medium text-fg-2">
              <Info className="h-3.5 w-3.5" />
              <span>使用说明与安全规范</span>
            </div>
            <p className="leading-relaxed">
              • 本功能直接调用本地官方 Antigravity CLI 的只读指令（
              <code className="text-fg-2">agy.exe --print /usage</code>
              ）实时读取账号配额，无需任何敏感凭据授权，完全符合独立进程与最小权限原则。
            </p>
            <p className="leading-relaxed">
              • 推荐辅助可执行文件路径：
              <code className="text-fg-2">%LOCALAPPDATA%\cc-switch\tools\antigravity\agy.exe</code>
              （备用：<code className="text-fg-2">%LOCALAPPDATA%\agy\bin\agy.exe</code>）。
            </p>
            <p className="leading-relaxed">
              • 若尚未登录或提示认证过期，点击右上角「打开终端登录」即可弹出官方 CLI 控制台完成 Google 登录。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
