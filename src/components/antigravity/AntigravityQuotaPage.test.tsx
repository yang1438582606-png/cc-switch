import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { AntigravityQuotaPage } from "./AntigravityQuotaPage";
import {
  formatPercent,
  formatResetTime,
  getWindowLabel,
  type AntigravityQuotaData,
} from "./antigravityTypes";
import { isGlobalPage, parseView } from "@/lib/navigation";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => {
      if (typeof options === "string") return options;
      if (options && typeof options === "object" && "defaultValue" in (options as Record<string, unknown>)) {
        return (options as Record<string, unknown>).defaultValue;
      }
      return key;
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
  return { ...view, queryClient };
}

const mockQuotaData: AntigravityQuotaData = {
  account: "t***@gmail.com",
  source: "Antigravity CLI (/usage)",
  updatedAt: "2026-10-08T10:00:00Z",
  groups: [
    {
      name: "Gemini Models",
      description: "Models within this group: Gemini Flash, Gemini Pro",
      buckets: [
        {
          id: "gemini-weekly",
          name: "Weekly Limit Remaining",
          window: "weekly",
          remainingPercent: 99.56,
          resetTime: "2026-10-15T06:18:47Z",
          description: "Refreshes in 6 days",
        },
        {
          id: "gemini-5h",
          name: "Five Hour Limit Remaining",
          window: "5h",
          remainingPercent: 97.35,
          resetTime: "2026-10-08T11:18:47Z",
        },
      ],
    },
    {
      name: "Claude and GPT models",
      description: "Models: Claude Opus, Sonnet",
      buckets: [
        {
          id: "3p-custom",
          name: "Special Window",
          window: "custom_window",
          remainingPercent: null, // Test unknown/unsupported value
          resetTime: null,
        },
      ],
    },
  ],
};

describe("Antigravity Types & Formatters", () => {
  it("formatPercent handles valid numbers, boundaries, and invalid values", () => {
    expect(formatPercent(100)).toBe("100.00%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(99.55878)).toBe("99.56%");
    expect(formatPercent(50.1)).toBe("50.10%");

    // Invalid or missing values should return '未知' and never fake 0 or 100
    expect(formatPercent(null)).toBe("未知");
    expect(formatPercent(undefined)).toBe("未知");
    expect(formatPercent(NaN)).toBe("未知");
    expect(formatPercent(-0.01)).toBe("未知");
    expect(formatPercent(100.01)).toBe("未知");
  });

  it("formatResetTime handles ISO dates and invalid strings", () => {
    expect(formatResetTime(null)).toBe("未知");
    expect(formatResetTime(undefined)).toBe("未知");
    expect(formatResetTime("not-a-date")).toBe("未知");

    const formatted = formatResetTime("2026-10-15T06:18:47Z");
    expect(formatted).not.toBe("未知");
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("getWindowLabel translates common windows and preserves unknown windows", () => {
    expect(getWindowLabel("5h")).toBe("5 小时配额");
    expect(getWindowLabel("weekly")).toBe("每周配额");
    expect(getWindowLabel("daily")).toBe("每日配额");
    expect(getWindowLabel("custom_future_window")).toBe("custom_future_window 配额");
    expect(getWindowLabel(null)).toBe("未知周期");
  });
});

describe("AntigravityQuotaPage Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries quota on mount and renders groups and buckets", async () => {
    invokeMock.mockResolvedValueOnce(mockQuotaData);

    renderWithClient(<AntigravityQuotaPage />);

    expect(invokeMock).toHaveBeenCalledWith("query_antigravity_quota");

    await waitFor(() => {
      expect(screen.getByText("Gemini Models")).toBeInTheDocument();
      expect(screen.getByText("Claude and GPT models")).toBeInTheDocument();
    });

    expect(screen.getByText("t***@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("99.56%")).toBeInTheDocument();
    expect(screen.getByText("97.35%")).toBeInTheDocument();
    // Bucket with null percent displays '未知'
    expect(screen.getByText("未知")).toBeInTheDocument();
  });

  it("handles error state and provides login action button when auth is required", async () => {
    invokeMock.mockRejectedValueOnce(new Error("需要登录 Antigravity CLI：请先在终端中完成账号登录"));

    renderWithClient(<AntigravityQuotaPage />);

    await waitFor(() => {
      expect(screen.getByText(/需要登录 Antigravity CLI/)).toBeInTheDocument();
      expect(screen.getByText("立即终端登录")).toBeInTheDocument();
    });

    // Click terminal login button
    invokeMock.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByText("立即终端登录"));
    expect(invokeMock).toHaveBeenCalledWith("open_antigravity_cli");
  });

  it("supports manual refresh button when success", async () => {
    invokeMock.mockResolvedValueOnce(mockQuotaData);

    renderWithClient(<AntigravityQuotaPage />);

    await waitFor(() => {
      expect(screen.getByText("Gemini Models")).toBeInTheDocument();
    });

    // Mock next refresh call
    invokeMock.mockResolvedValueOnce({
      ...mockQuotaData,
      groups: [
        {
          name: "Updated Models",
          buckets: [],
        },
      ],
    });

    const refreshButton = screen.getByRole("button", { name: /刷新配额/ });
    await userEvent.click(refreshButton);

    await waitFor(() => {
      expect(screen.getByText("Updated Models")).toBeInTheDocument();
    });
    expect(toast.success).toHaveBeenCalledWith("配额已刷新");
  });

  it("shows error and removes stale quota cards when manual refresh fails", async () => {
    invokeMock.mockResolvedValueOnce(mockQuotaData);

    const { queryClient } = renderWithClient(<AntigravityQuotaPage />);

    await waitFor(() => {
      expect(screen.getByText("Gemini Models")).toBeInTheDocument();
    });

    // Refresh fails
    invokeMock.mockRejectedValueOnce(new Error("网络连接超时"));

    const refreshButton = screen.getByRole("button", { name: /刷新配额/ });
    await userEvent.click(refreshButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("配额查询失败: 网络连接超时");
      // Toast success must NOT be called on failure
      expect(toast.success).not.toHaveBeenCalled();
      // Old quota cards must be hidden / not in document
      expect(screen.queryByText("Gemini Models")).not.toBeInTheDocument();
      // Error message banner must be displayed
      expect(screen.getByText(/网络连接超时/)).toBeInTheDocument();
      expect(queryClient.getQueryData(["antigravity-quota"])).toBeNull();
      expect(queryClient.getQueryState(["antigravity-quota"])?.status).toBe("error");
    });
  });
});

describe("Navigation Integration for Antigravity", () => {
  it("recognizes antigravityQuota as a valid global page and parses it", () => {
    expect(isGlobalPage("antigravityQuota")).toBe(true);
    expect(parseView("antigravityQuota")).toBe("antigravityQuota");
    expect(isGlobalPage("nonExistentPage" as any)).toBe(false);
  });
});
