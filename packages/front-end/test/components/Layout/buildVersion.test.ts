import { buildVersion } from "@/components/Layout/buildVersion";

describe("buildVersion", () => {
  it("joins the last version and the short commit", () => {
    expect(
      buildVersion({
        lastVersion: "4.2.0",
        sha: "bd13c78a1f2e3d4c5b6a7980",
        date: "2026-10-30T12:34:56Z",
      }),
    ).toEqual({
      label: "4.2.0+bd13c78",
      date: "2026-10-30",
      commitUrl:
        "https://github.com/growthbook/growthbook/commit/bd13c78a1f2e3d4c5b6a7980",
    });
  });

  it("shows nothing without a commit", () => {
    expect(
      buildVersion({ lastVersion: "4.2.0", sha: "", date: "2026-10-30" }),
    ).toBeNull();
  });

  it("shows the commit alone without a version", () => {
    expect(
      buildVersion({ lastVersion: "", sha: "bd13c78a1f2e", date: "" }),
    ).toEqual({
      label: "bd13c78",
      date: null,
      commitUrl: "https://github.com/growthbook/growthbook/commit/bd13c78a1f2e",
    });
  });
});
