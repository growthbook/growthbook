import { resolveAgentInternalHref } from "@/components/Agent/agentLinkUtils";

describe("resolveAgentInternalHref", () => {
  it("preserves root-relative links", () => {
    expect(resolveAgentInternalHref("/settings?tab=general#approvals")).toBe(
      "/settings?tab=general#approvals",
    );
  });

  it.each([
    "/features/dark-mode",
    "/experiment/exp_abc123",
    "/experiments",
    "/metric/met_abc123",
    "/metrics",
    "/fact-metrics/fm_abc123",
    "/fact-tables",
    "/projects/prj_abc123",
    "/environments",
    "/product-analytics/dashboards/dash_abc123",
  ])("normalizes an absolute GrowthBook app route: %s", (pathname) => {
    expect(
      resolveAgentInternalHref(
        `https://growthbook.internal${pathname}`,
        "https://growthbook.internal",
      ),
    ).toBe(pathname);
  });

  it("preserves the exact path, query, and hash when normalizing", () => {
    expect(
      resolveAgentInternalHref(
        "https://app.growthbook.io/features/dark-mode?v=2%2B3#rules",
      ),
    ).toBe("/features/dark-mode?v=2%2B3#rules");
  });

  it("normalizes any same-origin URL", () => {
    expect(
      resolveAgentInternalHref(
        "https://growthbook.internal/product-analytics/explore?config=eyJmb28iOiJiYXIifQ%3D%3D#results",
        "https://growthbook.internal",
      ),
    ).toBe(
      "/product-analytics/explore?config=eyJmb28iOiJiYXIifQ%3D%3D#results",
    );
  });

  it("normalizes a cloud app link when the current origin is self-hosted", () => {
    expect(
      resolveAgentInternalHref(
        "https://app.growthbook.io/features/dark-mode",
        "https://growthbook.internal",
      ),
    ).toBe("/features/dark-mode");
  });

  it("normalizes any cloud app route for a self-hosted origin", () => {
    expect(
      resolveAgentInternalHref(
        "https://app.growthbook.io/product-analytics/explore?config=abc",
        "https://growthbook.internal",
      ),
    ).toBe("/product-analytics/explore?config=abc");
  });

  it.each([
    "https://docs.growthbook.io/features/basics",
    "https://example.com/features/dark-mode",
    "https://example.com/features-old/dark-mode",
    "//app.growthbook.io/features/dark-mode",
    "mailto:team@example.com",
    "not a url",
  ])("leaves a non-app link external: %s", (href) => {
    expect(resolveAgentInternalHref(href)).toBeNull();
  });
});
