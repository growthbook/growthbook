import { getLegacyDashboardRedirect } from "@/components/Insights/legacyDashboardRedirect";

describe("getLegacyDashboardRedirect", () => {
  it("sends links without a metric to Health", () => {
    expect(getLegacyDashboardRedirect({})).toBe("/insights/health");
    expect(getLegacyDashboardRedirect({ dateRange: "90" })).toBe(
      "/insights/health",
    );
    expect(getLegacyDashboardRedirect({ dateRange: "30", q: "x" })).toBe(
      "/insights/health?range=last30Days",
    );
  });

  it("sends links with a metric to Impact with its range and search", () => {
    expect(
      getLegacyDashboardRedirect({
        selectedMetric: "met_1",
        dateRange: "custom",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        q: "tag:checkout",
      }),
    ).toBe(
      "/insights/impact?range=customDateRange&start=2026-01-01&end=2026-02-01&metric=met_1&q=tag%3Acheckout",
    );
  });

  it("keeps saved dates even with a preset range", () => {
    expect(
      getLegacyDashboardRedirect({
        dateRange: "90",
        startDate: "2025-01-01",
        endDate: "2025-04-01",
      }),
    ).toBe(
      "/insights/health?range=customDateRange&start=2025-01-01&end=2025-04-01",
    );
  });

  it("turns other day counts into a custom lookback", () => {
    expect(getLegacyDashboardRedirect({ dateRange: "180" })).toBe(
      "/insights/health?range=customLookback&lookback=180&unit=day",
    );
  });
});
