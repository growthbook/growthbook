import { buildVersionLabel } from "@/components/Layout/buildVersion";

describe("buildVersionLabel", () => {
  it("joins the last version and the short commit", () => {
    expect(
      buildVersionLabel({
        lastVersion: "4.2.0",
        sha: "bd13c78a1f2e3d4c5b6a7980",
      }),
    ).toBe("4.2.0+bd13c78");
  });

  it("shows nothing without a commit", () => {
    expect(buildVersionLabel({ lastVersion: "4.2.0", sha: "" })).toBeNull();
  });

  it("shows the commit alone without a version", () => {
    expect(buildVersionLabel({ lastVersion: "", sha: "bd13c78a1f2e" })).toBe(
      "bd13c78",
    );
  });
});
