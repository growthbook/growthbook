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
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api/api.setup";

/**
 * Every feature-revision state transition must refuse a revision whose status
 * moved since the caller read it.
 *
 * These four write against real Mongo with no status predicate at all until
 * recently: each screens status on a copy read several awaits earlier, so a publish
 * landing in that window had the write demote the LIVE revision — back to
 * `pending-review` with `datePublished` nulled, back to `draft` with its verdicts
 * wiped, or stamped with auto-publish state on released history.
 *
 * The generic engine's twins were CAS-guarded first and these were missed, so the
 * mutation that matters for each case is "remove `status` from the filter" — do that
 * and the corresponding case here goes green-to-red. Nothing else in the suite
 * notices, which is why these exist.
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
        false,
      ),
    ).rejects.toThrow(/changed while the request was in flight/i);

    // The content write is what must not land — a published revision's stored
    // values are the record of what went live.
    const doc = await stored();
    expect(doc?.defaultValue).toBe("false");
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
      false,
    );
    expect((await stored())?.defaultValue).toBe("true");
  });
});
