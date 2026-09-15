import mongoose from "mongoose";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  markRevisionAsReviewRequested,
  recallReview,
  submitReviewAndComments,
  undoReview,
} from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api/api.setup";

/**
 * When a verdict does not persist, the caller has to be told.
 *
 * Both halves of `submitReviewAndComments` refuse correctly when a concurrent
 * recall/discard/publish moves the revision out of the review cycle. A refusal
 * that never reaches the caller still writes the review log, dispatches
 * webhooks, considers auto-publishing, and answers 200 for a verdict that is not
 * in the document — worse than a plain lost write.
 *
 * `applied` is the signal. These pin it at the model, where the refusal is
 * decided; the three call sites turn it into an error.
 */

const ORG_ID = "org_verdict_applied";

describe("submitReviewAndComments reports whether the verdict landed", () => {
  setupApp();

  const context = {
    org: { id: ORG_ID, settings: {} },
    userId: "u_reviewer",
    models: {
      featureRevisionLogs: { create: async () => undefined },
    },
  } as never;

  const user = {
    type: "dashboard" as const,
    id: "u_reviewer",
    email: "r@t.co",
    name: "R",
  };

  const seed = async (status: string): Promise<FeatureRevisionInterface> => {
    await mongoose.connection
      .collection("featurerevisions")
      .deleteMany({ organization: ORG_ID });
    const doc = {
      organization: ORG_ID,
      featureId: "feat_applied",
      version: 2,
      status,
      // Present (not undefined) so the legacy self-heal branch is skipped and the
      // ordinary $pull/$push path runs — the one whose match count is the signal.
      reviews: [],
      createdBy: { type: "dashboard", id: "u_author", email: "", name: "" },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    await mongoose.connection.collection("featurerevisions").insertOne(doc);
    return doc as unknown as FeatureRevisionInterface;
  };

  const stored = async () =>
    await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: "feat_applied", version: 2 });

  it("reports not-applied when the revision left the review cycle", async () => {
    // The caller's copy still says pending-review — it is the stale read a recall
    // has already superseded, which is exactly the race.
    const stale = await seed("pending-review");
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: "feat_applied", version: 2 },
        { $set: { status: "draft" } },
      );

    const result = await submitReviewAndComments(
      context,
      stale,
      user,
      "Approved",
      undefined,
      1,
    );

    expect(result.applied).toBe(false);
    const row = await stored();
    // And nothing landed: no verdict to be reconciled from later, no status change.
    expect(row?.status).toBe("draft");
    expect(row?.reviews).toEqual([]);
  });

  it("reports applied on the ordinary path", async () => {
    // The control. Reporting `false` unconditionally would pass the case above and
    // break every real review.
    const revision = await seed("pending-review");

    const result = await submitReviewAndComments(
      context,
      revision,
      user,
      "Approved",
      undefined,
      1,
    );

    expect(result.applied).toBe(true);
    const row = await stored();
    expect(row?.status).toBe("approved");
    expect((row?.reviews as unknown[]).length).toBe(1);
  });

  it("refuses a verdict formed against a superseded review cycle", async () => {
    // The feature engine's half of the same ABA. Recall-and-resubmit puts the row
    // back at `pending-review` — the value it held when the reviewer opened it — so
    // status alone cannot tell the retracted request from the new one. Only the
    // cycle number can, and both of this function's writes carry it.
    const stale = await seed("pending-review");
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: "feat_applied", version: 2 },
        { $set: { reviewCycle: 2 } },
      );

    const result = await submitReviewAndComments(
      context,
      // Read at cycle 1 (absent → 0 would match the seeded row, so name it).
      { ...stale, reviewCycle: 1 } as never,
      user,
      "Approved",
      undefined,
      1,
    );

    expect(result.applied).toBe(false);
    const row = await stored();
    expect(row?.status).toBe("pending-review");
    expect(row?.reviews).toEqual([]);
  });

  it("bumps the stored cycle on recall, so the guard can ever fire", async () => {
    // The guard above is only as good as the bump that feeds it, and on this engine
    // the bump is the half that can vanish silently: the Mongoose schema is
    // explicit, so a `reviewCycle` it doesn't declare is dropped from `$set` AND
    // from the filter — no error, just a guard that never sees two different
    // numbers. Reading the number back off the document is what proves otherwise.
    const revision = await seed("pending-review");
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: "feat_applied", version: 2 },
        { $set: { reviewCycle: 1 } },
      );

    await recallReview(context, { ...revision, reviewCycle: 1 } as never, user);

    expect((await stored())?.reviewCycle).toBe(2);
  });

  it("never moves the cycle backwards from a stale caller copy", async () => {
    // The number has to be MONOTONIC, not merely different. These writes filter on
    // `status`, which a recall/resubmit pair restores — so a caller holding a copy
    // read several awaits ago still matches, and computing `copy.reviewCycle + 1`
    // stamped a number LOWER than the stored one. That doesn't just lose the
    // identity, it REUSES a number an in-flight verdict was formed against, which
    // is precisely the ABA the cycle exists to stop. `$inc` is what makes it
    // monotonic regardless of what the caller read.
    const stale = await seed("draft");
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: "feat_applied", version: 2 },
        { $set: { reviewCycle: 7 } },
      );

    // The caller still believes it is cycle 1.
    await markRevisionAsReviewRequested(
      context,
      { ...stale, reviewCycle: 1 } as never,
      user,
    );

    expect((await stored())?.reviewCycle).toBe(8);
  });

  it("refuses a RETRACTION formed against a superseded review cycle", async () => {
    // The verdict guard's mirror image, and it has to exist for the same reason:
    // this reviewer's verdict on the new cycle is indistinguishable from their
    // verdict on the retracted one, so an undo in flight across a recall/resubmit
    // removes a verdict its sender never saw. Worse than the verdict case in one
    // way — dropping a `changes-requested` can resolve the revision to `approved`
    // and fire auto-publish on changes nobody cleared.
    const stale = await seed("changes-requested");
    await mongoose.connection.collection("featurerevisions").updateOne(
      { organization: ORG_ID, featureId: "feat_applied", version: 2 },
      {
        $set: {
          reviewCycle: 2,
          reviews: [
            {
              userId: "u_reviewer",
              user,
              status: "changes-requested",
              timestamp: new Date(),
            },
          ],
        },
      },
    );

    await expect(
      undoReview(context, { ...stale, reviewCycle: 1 } as never, user),
    ).rejects.toThrow(/superseded/i);

    const row = await stored();
    expect(row?.status).toBe("changes-requested");
    expect((row?.reviews as unknown[]).length).toBe(1);
  });

  it("still retracts within the caller's own cycle", async () => {
    // The control. A guard that refused everything would pass the case above and
    // break every real retraction.
    const revision = await seed("changes-requested");
    await mongoose.connection.collection("featurerevisions").updateOne(
      { organization: ORG_ID, featureId: "feat_applied", version: 2 },
      {
        $set: {
          reviewCycle: 1,
          reviews: [
            {
              userId: "u_reviewer",
              user,
              status: "changes-requested",
              timestamp: new Date(),
            },
          ],
        },
      },
    );

    await undoReview(context, { ...revision, reviewCycle: 1 } as never, user);

    const row = await stored();
    expect(row?.status).toBe("pending-review");
    expect(row?.reviews).toEqual([]);
  });

  it("reports applied for a plain comment, which writes no verdict", async () => {
    // Comments take the `verdict === null` path, which never touches the revision
    // and so has nothing to refuse. It must not be reported as a failure.
    const revision = await seed("pending-review");

    const result = await submitReviewAndComments(
      context,
      revision,
      user,
      "Comment",
      "looks fine",
      1,
    );

    expect(result.applied).toBe(true);
    expect((await stored())?.status).toBe("pending-review");
  });
});
