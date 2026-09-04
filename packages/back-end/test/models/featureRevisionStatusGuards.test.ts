import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContextClass } from "back-end/src/services/context";
import {
  markRevisionAsReviewRequested,
  recallReview,
  setAutoPublishOnApproval,
  setRevisionScheduledPublish,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api/api.setup";

/**
 * Every feature-revision state transition must refuse a revision whose status
 * moved since the caller read it. Each screens status on a copy read several
 * awaits earlier, so a publish landing in that window would otherwise demote the
 * LIVE revision — back to `pending-review` with `datePublished` nulled, back to
 * `draft` with its verdicts wiped, or stamped with auto-publish state on
 * released history. The guard is `status` in the write FILTER; same rule as the
 * generic engine's CAS-guarded twins.
 */

const ORG_ID = "org_feature_revision_guards";
const FEATURE_ID = "guarded-revision-flag";

const org = {
  id: ORG_ID,
  name: "Feature Revision Guards",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

const feature = {
  id: FEATURE_ID,
  organization: ORG_ID,
  valueType: "boolean",
  defaultValue: "false",
  version: 1,
  project: "",
  environmentSettings: { production: { enabled: false, rules: [] } },
} as unknown as FeatureInterface;

const user = { type: "dashboard", id: "u_author", email: "a@t.co", name: "A" };

describe("feature revision status guards", () => {
  setupApp();
  let context: ReqContextClass;

  /** The caller's copy: read BEFORE the concurrent publish below. */
  const asRead = (status: string): FeatureRevisionInterface =>
    ({
      organization: ORG_ID,
      featureId: FEATURE_ID,
      version: 2,
      status,
      baseVersion: 1,
      createdBy: user,
      comment: "",
      rules: { production: [] },
      defaultValue: "false",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    }) as unknown as FeatureRevisionInterface;

  const seed = async (status: string) => {
    // The parent feature has to exist: the revision log is written through a model
    // whose canCreate resolves a foreign ref to it, and the write is fire-and-forget
    // — so without this the log assertions below would pass by silently logging
    // nothing, which is precisely the bug they exist to catch.
    await mongoose.connection
      .collection("features")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection.collection("features").insertOne({
      ...feature,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await mongoose.connection
      .collection("featurerevisions")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection.collection("featurerevisions").insertOne({
      ...asRead(status),
    });
  };

  /** What a concurrent publish does: claims the revision while we hold a stale copy. */
  const publishConcurrently = async () => {
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: FEATURE_ID, version: 2 },
        { $set: { status: "published", datePublished: new Date() } },
      );
  };

  const stored = async () =>
    mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: FEATURE_ID, version: 2 });

  beforeEach(async () => {
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
  });

  it("markRevisionAsReviewRequested refuses a revision published mid-request", async () => {
    await seed("draft");
    const stale = asRead("draft");
    await publishConcurrently();

    await expect(
      markRevisionAsReviewRequested(context, stale, user, "please review"),
    ).rejects.toThrow(/no longer a draft/i);

    // The whole point: released history is untouched. `datePublished` in
    // particular — that write nulls it unconditionally.
    const doc = await stored();
    expect({
      status: doc?.status,
      datePublished: !!doc?.datePublished,
    }).toEqual({ status: "published", datePublished: true });
  });

  it("recallReview refuses a revision published mid-request", async () => {
    await seed("pending-review");
    const stale = asRead("pending-review");
    await publishConcurrently();

    await expect(recallReview(context, stale, user)).rejects.toThrow(
      /no longer in review/i,
    );

    const doc = await stored();
    expect(doc?.status).toBe("published");
  });

  it("setAutoPublishOnApproval refuses a revision published mid-request", async () => {
    await seed("approved");
    const stale = asRead("approved");
    await publishConcurrently();

    await expect(
      setAutoPublishOnApproval(stale, true, "u_author"),
    ).rejects.toThrow(/published or discarded/i);

    const doc = await stored();
    expect(doc?.autoPublishOnApproval ?? false).toBe(false);
  });

  it("updateRevision refuses a revision whose status moved under it", async () => {
    await seed("draft");
    const stale = asRead("draft");
    await publishConcurrently();

    await expect(
      updateRevision(
        context,
        feature,
        stale,
        { defaultValue: "true" },
        { user, action: "edit", subject: "", value: "{}" },
      ),
    ).rejects.toThrow(/changed while the request was in flight/i);

    // The content write is what must not land — a published revision's stored
    // values are the record of what went live.
    const doc = await stored();
    expect(doc?.defaultValue).toBe("false");
  });

  /**
   * Cancelling a schedule. The guard has two halves: the terminal-status filter,
   * and the "something is armed" clause that makes `modifiedCount` mean what the
   * log below it reads it to mean.
   */
  describe("cancelling a scheduled publish", () => {
    const armed = async () => {
      await seed("approved");
      await mongoose.connection.collection("featurerevisions").updateOne(
        { organization: ORG_ID, featureId: FEATURE_ID, version: 2 },
        {
          $set: {
            autoPublishOnApproval: true,
            scheduledPublishAt: new Date(Date.now() + 86_400_000),
          },
        },
      );
    };

    // The log write is fire-and-forget, so a count taken immediately reads 0 whether
    // the write was suppressed or merely hasn't settled — which would make both
    // "logs NOTHING" cases below pass for the wrong reason. Settle first, always.
    const rawLogCount = () =>
      mongoose.connection.collection("featurerevisionlog").countDocuments({
        organization: ORG_ID,
        featureId: FEATURE_ID,
        action: "cancel scheduled publish",
      });

    // POLLED rather than slept. A fixed delay is a guess about machine speed, and
    // the one that fails is the one on a loaded CI box. Waiting for the row to
    // APPEAR returns as soon as it lands; expecting zero has nothing to wait for, so
    // it burns a fixed window once and reports whatever arrived.
    const settledLogCount = async (expected: number) => {
      if (expected > 0) {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          if ((await rawLogCount()) >= expected) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        return rawLogCount();
      }
      await new Promise((r) => setTimeout(r, 250));
      return rawLogCount();
    };
    const logCount = () => settledLogCount(0);

    beforeEach(async () => {
      await mongoose.connection
        .collection("featurerevisionlog")
        .deleteMany({ organization: ORG_ID });
    });

    it("disarms an armed revision and records it once", async () => {
      await armed();
      await setRevisionScheduledPublish(context, asRead("approved"), {
        scheduledPublishAt: null,
      });

      const doc = await stored();
      expect({
        armed: doc?.autoPublishOnApproval,
        at: doc?.scheduledPublishAt ?? null,
      }).toEqual({ armed: false, at: null });
      expect(await settledLogCount(1)).toBe(1);
    });

    it("writes and logs NOTHING when the revision was never armed", async () => {
      // `dateUpdated` is unconditionally in the `$set`, so without the
      // "something is armed" clause on the FILTER this always modified — logging a
      // cancellation nobody performed and bumping the timestamp for a no-op.
      await seed("approved");
      const before = await stored();
      await setRevisionScheduledPublish(context, asRead("approved"), {
        scheduledPublishAt: null,
      });

      const after = await stored();
      expect({
        logs: await logCount(),
        // `touched` is corroboration, never the pin: `dateUpdated` has millisecond
        // resolution, so a same-millisecond write compares EQUAL and it
        // false-negatives. `logs` is the real assertion.
        touched:
          after?.dateUpdated?.getTime?.() !== before?.dateUpdated?.getTime?.(),
      }).toEqual({ logs: 0, touched: false });
    });

    it("refuses a revision published mid-request", async () => {
      await armed();
      const stale = asRead("approved");
      await publishConcurrently();

      await setRevisionScheduledPublish(context, stale, {
        scheduledPublishAt: null,
      });

      // Terminal history keeps its schedule fields and gains no log entry.
      const doc = await stored();
      expect({
        status: doc?.status,
        armed: doc?.autoPublishOnApproval,
        logs: await logCount(),
      }).toEqual({ status: "published", armed: true, logs: 0 });
    });
  });

  it("updateRevision applies to a NON-draft whose status has not moved", async () => {
    // The guards suite otherwise only ever edits drafts, so hardcoding the filter
    // to `status: "draft"` — a plausible mis-fix of the same bug — would survive
    // every other case here.
    await seed("changes-requested");
    await updateRevision(
      context,
      feature,
      asRead("changes-requested"),
      { defaultValue: "edited" },
      { user, action: "edit", subject: "", value: "{}" },
    );
    expect((await stored())?.defaultValue).toBe("edited");
  });

  /**
   * The positive half. Without these, deleting the whole method body would pass the
   * four cases above, and a guard that refuses everything would look correct.
   */
  it("all four still apply when the status has NOT moved", async () => {
    await seed("draft");
    await markRevisionAsReviewRequested(context, asRead("draft"), user, "go");
    expect((await stored())?.status).toBe("pending-review");

    await recallReview(context, asRead("pending-review"), user);
    expect((await stored())?.status).toBe("draft");

    await setAutoPublishOnApproval(asRead("draft"), true, "u_author");
    expect((await stored())?.autoPublishOnApproval).toBe(true);

    await updateRevision(
      context,
      feature,
      asRead("draft"),
      { defaultValue: "true" },
      { user, action: "edit", subject: "", value: "{}" },
    );
    expect((await stored())?.defaultValue).toBe("true");
  });
});
