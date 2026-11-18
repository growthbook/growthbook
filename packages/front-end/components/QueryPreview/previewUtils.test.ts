import {
  formatPreviewHeadline,
  getPreviewDateRange,
  getPreviewUnitLabel,
} from "./previewUtils";

it("uses seven complete UTC days, including across month boundaries", () => {
  expect(getPreviewDateRange(new Date("2026-10-03T13:15:00Z"))).toEqual({
    predefined: "customDateRange",
    startDate: "2026-09-26",
    endDate: "2026-10-02",
  });
});

describe("getPreviewUnitLabel", () => {
  it("prefers the display name of the mapped column", () => {
    expect(
      getPreviewUnitLabel("user_id", {
        userIdColumns: { user_id: "customer_key" },
        columns: [{ column: "customer_key", name: "Members" }],
      }),
    ).toEqual({ label: "Members", column: "customer_key" });
  });
  it("uses common identifier names and preserves the raw column", () => {
    expect(getPreviewUnitLabel("userId", null)).toEqual({
      label: "Users",
      column: "userId",
    });
    expect(
      getPreviewUnitLabel("account_id", {
        columns: [],
        userIdColumns: { account_id: "properties.account" },
      }),
    ).toEqual({ label: "Accounts", column: "properties.account" });
  });
  it("humanizes unknown identifiers and ignores blank display names", () => {
    expect(
      getPreviewUnitLabel("workspace_key", {
        columns: [{ column: "workspace_key", name: "  " }],
      }),
    ).toEqual({ label: "Workspace Key", column: "workspace_key" });
  });
});

describe("formatPreviewHeadline", () => {
  it("keeps every magnitude short enough for the headline", () => {
    expect(formatPreviewHeadline(4.114)).toBe("4.11");
    expect(formatPreviewHeadline(27206)).toBe("27,206");
    expect(formatPreviewHeadline(99999.999)).toBe("100,000");
    expect(formatPreviewHeadline(1234567)).toBe("1.23M");
    expect(formatPreviewHeadline(-987654321098)).toBe("-987.65B");
    expect(formatPreviewHeadline(999.99e12)).toBe("999.99T");
    expect(formatPreviewHeadline(0.004216)).toBe("0.00422");
    expect(formatPreviewHeadline(0.0000123)).toBe("1.23e-5");
    expect(formatPreviewHeadline(0)).toBe("0");
  });
});
