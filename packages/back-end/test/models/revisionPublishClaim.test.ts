import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { ReqContextClass } from "back-end/src/services/context";
import { markRevisionAsPublished } from "back-end/src/models/FeatureRevisionModel";
import { ConflictError } from "back-end/src/util/errors";
import { setupApp } from "../api/api.setup";

/**
 * Claiming a feature revision as published is CAS-guarded, against real Mongo.
 *
 * The write carried no status condition, so two concurrent publishes of the same
 * revision both reported success — and the loser then compensated by reopening
 * what the winner had just published. The other three models guard this; the
 * feature family didn't.
 */

const ORG_ID = "org_publish_claim";
const org = {
  id: ORG_ID,
  name: "Publish Claim",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

const feature = {
  id: "claimed-flag",
  organization: ORG_ID,
  valueType: "boolean",
  defaultValue: "false",
  version: 1,
  environmentSettings: { production: { enabled: false, rules: [] } },
} as unknown as FeatureInterface;

describe("markRevisionAsPublished", () => {
  setupApp();
  let context: ReqContextClass;

  const baseline = new Date(Date.now() - 60_000);

  beforeEach(async () => {
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    await mongoose.connection
      .collection("featurerevisions")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection.collection("featurerevisions").insertOne({
      organization: ORG_ID,
      featureId: feature.id,
      version: 2,
      status: "draft",
      baseVersion: 1,
      defaultValue: "true",
      rules: [],
      dateCreated: baseline,
      dateUpdated: baseline,
      createdBy: { type: "api_key", apiKey: "key_test" },
    });
  });

  /** The revision as a caller read it before publishing. */
  function asRead(overrides: Partial<FeatureRevisionInterface> = {}) {
    return {
      organization: ORG_ID,
      featureId: feature.id,
      version: 2,
      status: "draft",
      baseVersion: 1,
      defaultValue: "true",
      rules: [],
      dateCreated: baseline,
      dateUpdated: baseline,
      ...overrides,
    } as unknown as FeatureRevisionInterface;
  }

  async function storedStatus() {
    const doc = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: feature.id, version: 2 });
    return doc?.status;
  }

  it("publishes a revision it read unchanged, and returns the stamp that landed", async () => {
    const stamp = await markRevisionAsPublished(
      context,
      feature,
      asRead(),
      context.auditUser,
    );

    expect(await storedStatus()).toBe("published");
    const doc = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: feature.id, version: 2 });
    // The returned stamp is the compensation fingerprint, so it has to be the
    // value actually written — not one computed alongside it.
    expect(stamp).toEqual(doc?.datePublished);
  });

  it("refuses a second publish of the same revision", async () => {
    const read = asRead();
    await markRevisionAsPublished(context, feature, read, context.auditUser);

    // The same in-memory revision a concurrent request would still be holding.
    await expect(
      markRevisionAsPublished(context, feature, read, context.auditUser),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses when the revision was edited since it was read", async () => {
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: feature.id, version: 2 },
        { $set: { defaultValue: "false", dateUpdated: new Date() } },
      );

    // Same status, newer content: the caller computed what to publish from the
    // version it read, so a same-status edit has to abort the claim too.
    await expect(
      markRevisionAsPublished(context, feature, asRead(), context.auditUser),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await storedStatus()).toBe("draft");
  });

  it("refuses when the revision was discarded since it was read", async () => {
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: feature.id, version: 2 },
        { $set: { status: "discarded" } },
      );

    await expect(
      markRevisionAsPublished(context, feature, asRead(), context.auditUser),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await storedStatus()).toBe("discarded");
  });

  // Re-publishing a live revision is a legitimate operation, so the guard has to
  // admit it rather than treating "already published" as a lost race.
  it("allows a re-publish of a revision that is already published", async () => {
    const published = new Date(Date.now() - 30_000);
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: feature.id, version: 2 },
        { $set: { status: "published", datePublished: published } },
      );

    const stamp = await markRevisionAsPublished(
      context,
      feature,
      asRead({ status: "published" }),
      context.auditUser,
    );

    expect(stamp).not.toBeNull();
    expect(await storedStatus()).toBe("published");
  });
});
