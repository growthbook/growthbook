import { describe, expect, it } from "vitest";
import { getRevisionStatus } from "@/services/revisionStatus";

type Args = Parameters<typeof getRevisionStatus>[0];
const revision = (fields: Partial<Args["revision"]>): Args["revision"] => ({
  status: "published",
  version: 3,
  autoPublishOnApproval: false,
  scheduledPublishAt: null,
  ...fields,
});
const status = (
  rev: Args["revision"],
  revisionList: Args["revisionList"] = [],
) => getRevisionStatus({ revision: rev, liveVersion: 3, revisionList });

const userDraft: Args["revisionList"][number] = {
  status: "draft",
  createdBy: { type: "dashboard", id: "u_1", email: "", name: "" },
};
const rampDraft: Args["revisionList"][number] = {
  status: "draft",
  createdBy: { type: "system", subtype: "ramp-schedule", id: "rs_1" },
};

describe("getRevisionStatus", () => {
  it.each([
    "draft",
    "pending-review",
    "approved",
    "changes-requested",
  ] as const)("reads a %s revision as a draft", (s) => {
    expect(status(revision({ status: s, version: 4 }))).toBe("draft");
  });

  it("reads a draft set to publish on a date as scheduled", () => {
    const rev = revision({
      status: "draft",
      version: 4,
      autoPublishOnApproval: true,
      scheduledPublishAt: new Date("2026-12-01T00:00:00Z"),
    });
    expect(status(rev)).toBe("scheduled");
  });

  it("reads a discarded revision as discarded", () => {
    expect(status(revision({ status: "discarded", version: 4 }))).toBe(
      "discarded",
    );
  });

  it("reads an older published revision as superseded", () => {
    expect(status(revision({ version: 2 }))).toBe("superseded");
  });

  it("flags live when someone has a draft open", () => {
    expect(status(revision({}), [userDraft])).toBe("liveWithDrafts");
  });

  it("says nothing about live when the only draft is a ramp's own", () => {
    expect(status(revision({}), [rampDraft])).toBeNull();
  });
});
