import { draftModeCta } from "@/components/DraftSelector";

describe("draftModeCta", () => {
  it("saves to a draft in either draft mode", () => {
    expect(draftModeCta("new", { bypassesApproval: true })).toEqual({
      label: "Save to draft",
      bypass: false,
    });
    expect(draftModeCta("existing", { bypassesApproval: false })).toEqual({
      label: "Save to draft",
      bypass: false,
    });
  });

  it("publishes, naming a skipped approval", () => {
    expect(draftModeCta("publish", { bypassesApproval: false })).toEqual({
      label: "Publish",
      bypass: false,
    });
    expect(draftModeCta("publish", { bypassesApproval: true })).toEqual({
      label: "Bypass approval & publish",
      bypass: true,
    });
  });

  it("takes a plain label for info edits that go live", () => {
    expect(
      draftModeCta("publish", {
        bypassesApproval: false,
        publishLabel: "Save",
      }).label,
    ).toBe("Save");
  });
});
