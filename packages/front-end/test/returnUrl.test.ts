import { getSafeReturnUrl } from "@/services/returnUrl";

describe("return navigation", () => {
  it.each([
    undefined,
    ["/metrics"],
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/\n/evil.test",
    "/a/..//evil.test",
    "javascript:alert(1)",
  ])("rejects nonlocal destination %s", (value) => {
    expect(getSafeReturnUrl(value)).toBe("/metrics");
  });
  it("preserves a local path with query and fragment", () => {
    expect(getSafeReturnUrl("/fact-tables/ft_1?tab=metrics#list")).toBe(
      "/fact-tables/ft_1?tab=metrics#list",
    );
  });
});
