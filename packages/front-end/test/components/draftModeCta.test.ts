import { draftModeCta } from "@/components/DraftSelector";

describe("draftModeCta", () => {
  it("saves to a draft in either draft mode", () => {
    expect(draftModeCta("new", { bypassesApproval: true })).toBe(
      "Save to draft",
    );
    expect(draftModeCta("existing", { bypassesApproval: false })).toBe(
      "Save to draft",
    );
  });

  it("publishes, naming a skipped approval", () => {
    expect(draftModeCta("publish", { bypassesApproval: false })).toBe(
      "Publish",
    );
    expect(draftModeCta("publish", { bypassesApproval: true })).toBe(
      "Bypass approval & publish",
    );
  });

  it("takes a plain label for info edits that go live", () => {
    expect(
      draftModeCta("publish", {
        bypassesApproval: false,
        publishLabel: "Save",
      }),
    ).toBe("Save");
  });
});
