import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContextClass } from "back-end/src/services/context";
import { updateRevision } from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api/api.setup";

/**
 * The persisted half of the derived review reset: an edit that adds a gated
 * change to an approved draft lands as `pending-review`, demotes the standing
 * verdicts to `-stale`, and opens a new review cycle — through the real
 * `updateRevision` write, with no caller flag involved.
 */

const ORG_ID = "org_approved_draft_edit_reset";
const FEATURE_ID = "approved-draft-edit-reset-flag";

const org = {
  id: ORG_ID,
  name: "Approved Draft Edit Reset",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "production", description: "" },
    ],
    requireReviews: [
      {
        requireReviewOn: true,
        resetReviewOnChange: true,
        environments: ["production"],
        projects: [],
      },
    ],
  },
} as unknown as OrganizationInterface;

const feature = {
  id: FEATURE_ID,
  organization: ORG_ID,
  valueType: "boolean",
  defaultValue: "false",
  version: 1,
  project: "",
  environmentSettings: {
    dev: { enabled: true, rules: [] },
    production: { enabled: true, rules: [] },
  },
} as unknown as FeatureInterface;

const user = { type: "dashboard", id: "u_author", email: "a@t.co", name: "A" };
const reviewer = {
  type: "dashboard" as const,
  id: "u_reviewer",
  email: "r@t.co",
  name: "R",
};
const log = { user, action: "edit", subject: "", value: "{}" };

describe("editing an approved draft", () => {
  setupApp();
  let context: ReqContextClass;

  const approved = (): FeatureRevisionInterface =>
    ({
      organization: ORG_ID,
      featureId: FEATURE_ID,
      version: 2,
      status: "approved",
      baseVersion: 1,
      createdBy: user,
      comment: "",
      rules: [],
      defaultValue: "false",
      environmentsEnabled: { dev: true, production: true },
      prerequisites: [],
      archived: false,
      holdout: null,
      reviews: [
        {
          userId: reviewer.id,
          user: reviewer,
          status: "approved",
          timestamp: new Date("2024-01-02"),
        },
      ],
      reviewCycle: 1,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    }) as unknown as FeatureRevisionInterface;

  const stored = async () =>
    mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: FEATURE_ID, version: 2 });

  beforeEach(async () => {
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
    await mongoose.connection
      .collection("featurerevisions")
      .insertOne({ ...approved() });

    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    // The derivation is licensed like publish-time review is.
    context.hasPremiumFeature = () => true;
  });

  it("a gated change sends it back for review and opens a new cycle", async () => {
    await updateRevision(
      context,
      feature,
      approved(),
      { environmentsEnabled: { dev: true, production: false } },
      log,
    );

    const doc = await stored();
    expect(doc?.status).toBe("pending-review");
    expect(doc?.reviews?.[0]?.status).toBe("approved-stale");
    expect(doc?.reviewCycle).toBe(2);
    expect(doc?.environmentsEnabled).toEqual({ dev: true, production: false });
  });

  it("a change outside the gate keeps the approval and its verdicts", async () => {
    await updateRevision(
      context,
      feature,
      approved(),
      { environmentsEnabled: { dev: false, production: true } },
      log,
    );

    const doc = await stored();
    expect(doc?.status).toBe("approved");
    expect(doc?.reviews?.[0]?.status).toBe("approved");
    expect(doc?.reviewCycle).toBe(1);
    expect(doc?.environmentsEnabled).toEqual({ dev: false, production: true });
  });
});
