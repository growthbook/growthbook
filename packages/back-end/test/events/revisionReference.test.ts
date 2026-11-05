import type { Revision } from "shared/enterprise";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { Context } from "back-end/src/models/BaseModel";
import {
  featureRevisionReference,
  revisionReference,
} from "back-end/src/events/revisionReference";

// A schedule change edits no content, so the reference is all that tells an
// arm from a move or a cancel.
describe("revision webhook references", () => {
  const at = new Date("2026-11-01T10:00:00Z");
  const author = {
    type: "dashboard" as const,
    id: "u_dana",
    name: "Dana",
    email: "",
  };
  const context = {
    models: { revisions: { getBaseVersion: async () => 2 } },
  } as unknown as Context;

  it("carries a generic revision's state", async () => {
    const revision = {
      id: "rev_1",
      status: "approved",
      authorId: "u_dana",
      activityLog: [{ action: "created", userId: "u_dana", user: author }],
      reviews: [],
      dateCreated: at,
      dateUpdated: at,
      autoPublishOnApproval: true,
      scheduledPublishAt: at,
      scheduledPublishLockEdits: true,
    } as unknown as Revision;

    expect(await revisionReference(context, revision)).toMatchObject({
      // Saved before versions were recorded.
      version: 0,
      baseVersion: 2,
      comment: "",
      dateCreated: at.toISOString(),
      autoPublishOnApproval: true,
      scheduledPublishAt: at.toISOString(),
      scheduledPublishLockEdits: true,
    });
    expect(
      await revisionReference(context, {
        ...revision,
        autoPublishOnApproval: false,
        scheduledPublishAt: null,
        scheduledPublishLockEdits: false,
      }),
    ).not.toHaveProperty("scheduledPublishAt");
  });

  it("carries a flag draft's base version, schedule and deprecated fields", () => {
    const revision = {
      featureId: "checkout",
      version: 7,
      baseVersion: 5,
      status: "pending-review",
      comment: "Shorter copy",
      createdBy: author,
      dateCreated: at,
      dateUpdated: at,
      scheduledPublishAt: at,
    } as unknown as FeatureRevisionInterface;

    expect(featureRevisionReference(revision)).toEqual(
      expect.objectContaining({
        version: 7,
        baseVersion: 5,
        comment: "Shorter copy",
        scheduledPublishAt: at.toISOString(),
        featureId: "checkout",
        date: at.toISOString(),
        createdBy: "Dana",
      }),
    );
    expect(featureRevisionReference(revision)).not.toHaveProperty(
      "publishedBy",
    );
  });
});
