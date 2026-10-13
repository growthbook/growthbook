import type { Revision } from "shared/enterprise";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
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

  it("carries a generic revision's schedule", () => {
    const revision = {
      id: "rev_1",
      version: 3,
      status: "approved",
      authorId: "u_dana",
      activityLog: [{ action: "created", userId: "u_dana", user: author }],
      reviews: [],
      autoPublishOnApproval: true,
      scheduledPublishAt: at,
      scheduledPublishLockEdits: true,
    } as unknown as Revision;

    expect(revisionReference(revision)).toMatchObject({
      version: 3,
      autoPublishOnApproval: true,
      scheduledPublishAt: at.toISOString(),
      scheduledPublishLockEdits: true,
    });
    expect(
      revisionReference({
        ...revision,
        autoPublishOnApproval: false,
        scheduledPublishAt: null,
        scheduledPublishLockEdits: false,
      }),
    ).not.toHaveProperty("scheduledPublishAt");
  });

  it("carries a flag draft's base version and schedule", () => {
    const revision = {
      featureId: "checkout",
      version: 7,
      baseVersion: 5,
      status: "pending-review",
      createdBy: author,
      scheduledPublishAt: at,
    } as unknown as FeatureRevisionInterface;

    expect(featureRevisionReference(revision)).toMatchObject({
      version: 7,
      baseVersion: 5,
      scheduledPublishAt: at.toISOString(),
    });
  });
});
