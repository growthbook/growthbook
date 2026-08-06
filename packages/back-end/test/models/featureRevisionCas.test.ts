import mongoose from "mongoose";
import { casUpdate } from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api/api.setup";

/**
 * The compare-and-swap loop feature revisions use.
 *
 * It is a second implementation of the same skeleton as `BaseModel.updateWithCas`
 * (feature revisions are keyed by `{organization, featureId, version}`, not by a
 * single id), and every subtlety in it was invisible from its four call sites:
 * mutating the absence guard, hoisting the read out of the loop, and swapping
 * aborted for exhausted all left the whole back-end suite green.
 */

const ORG_ID = "org_fr_cas";
const FEATURE_ID = "cas-flag";
const VERSION = 3;

const filter = {
  organization: ORG_ID,
  featureId: FEATURE_ID,
  version: VERSION,
};

describe("feature revision casUpdate", () => {
  setupApp();

  const collection = () => mongoose.connection.collection("featurerevisions");

  beforeEach(async () => {
    await collection().deleteMany({ organization: ORG_ID });
    await collection().insertOne({
      ...filter,
      status: "pending-review",
      baseVersion: 2,
      defaultValue: "true",
      rules: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      createdBy: { type: "api_key", apiKey: "k" },
    });
  });

  const stored = () => collection().findOne(filter);

  it("applies a guarded update when nothing moved", async () => {
    const outcome = await casUpdate(filter, ["status"], () => ({
      $set: { status: "approved" },
    }));

    expect(outcome).toBe("applied");
    expect((await stored())?.status).toBe("approved");
  });

  it("reports a missing document as ABORTED, not exhausted", async () => {
    const build = jest.fn();
    const outcome = await casUpdate(
      { ...filter, version: 99 },
      ["status"],
      build,
    );

    // The two outcomes are not interchangeable: `undoReview` turns aborted into
    // "Could not find feature revision" and exhausted into "concurrent update,
    // please retry".
    expect(outcome).toBe("aborted");
    expect(build).not.toHaveBeenCalled();
  });

  it("reports a build that declines as ABORTED, writing nothing", async () => {
    const outcome = await casUpdate(filter, ["status"], () => null);

    expect(outcome).toBe("aborted");
    expect((await stored())?.status).toBe("pending-review");
  });

  it("re-reads on every attempt, so a retry guards on what is there now", async () => {
    let calls = 0;
    const seen: (string | undefined)[] = [];
    const outcome = await casUpdate(filter, ["status"], async (current) => {
      calls++;
      seen.push(current.status);
      // A rival lands once, between our read and our write.
      if (calls === 1) {
        await collection().updateOne(filter, {
          $set: { status: "changes-requested" },
        });
      }
      return { $set: { defaultValue: "false" } };
    });

    expect(outcome).toBe("applied");
    // The second attempt saw the RIVAL's value. A read hoisted out of the loop
    // re-guards on the stale one, and the loop can never converge.
    expect(seen).toEqual(["pending-review", "changes-requested"]);
    expect((await stored())?.defaultValue).toBe("false");
  });

  it("reports EXHAUSTED when the guard never converges", async () => {
    let calls = 0;
    const outcome = await casUpdate(
      filter,
      ["status"],
      async () => {
        calls++;
        // Always move out of band, so no guard can ever match.
        await collection().updateOne(filter, {
          $set: { status: `s${calls}` },
        });
        return { $set: { defaultValue: "false" } };
      },
      3,
    );

    expect(outcome).toBe("exhausted");
    expect(calls).toBe(3);
    expect((await stored())?.defaultValue).toBe("true");
  });

  it("guards a field's ABSENCE, so a concurrent first write is not clobbered", async () => {
    // The legacy self-heal shape: `reviews` exists only on newer revisions, and the
    // seeding write is conditioned on it still being missing.
    await collection().updateOne(filter, { $unset: { reviews: "" } });

    let calls = 0;
    const outcome = await casUpdate(filter, ["reviews"], async (current) => {
      calls++;
      if (calls === 1) {
        await collection().updateOne(filter, {
          $set: { reviews: [{ userId: "rival", status: "approved" }] },
        });
      }
      return {
        $set: {
          reviews: [
            ...(current.reviews ?? []),
            { userId: "ours", status: "approved" },
          ],
        },
      };
    });

    expect(outcome).toBe("applied");
    expect(calls).toBe(2);
    // Both entries survive. Guarding on the raw `undefined` instead of `$exists`
    // makes the first write land unconditionally and drops the rival's verdict.
    expect(
      ((await stored())?.reviews as { userId: string }[])
        .map((r) => r.userId)
        .sort(),
    ).toEqual(["ours", "rival"]);
  });

  it("hands `build` the guard fields only", async () => {
    let seen: Record<string, unknown> = {};
    await casUpdate(filter, ["status"], (current) => {
      seen = current as Record<string, unknown>;
      return { $set: { defaultValue: "false" } };
    });

    expect(seen.status).toBe("pending-review");
    // Not merely unused — NOT FETCHED. `applyRevisionPublishClaim` lists an
    // immutable field in `guardFields` purely to get it, which only makes sense
    // while this holds.
    expect(seen.defaultValue).toBeUndefined();
    expect(seen.baseVersion).toBeUndefined();
  });
});
