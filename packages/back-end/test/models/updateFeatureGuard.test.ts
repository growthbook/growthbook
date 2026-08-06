import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { getFeature, updateFeature } from "back-end/src/models/FeatureModel";
import { setupApp } from "../api/api.setup";

/**
 * The feature landing guard, against real Mongo: the write must refuse a stale
 * pre-image, and holdout removal must ride the SAME updateOne as the content
 * $set — as two writes, the gap between them was a lost-update window.
 */

const ORG_ID = "org_feature_guard";

const org = {
  id: ORG_ID,
  name: "Feature Guard",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

describe("updateFeature's landing guard", () => {
  setupApp();
  let context: ReqContextClass;

  beforeEach(async () => {
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    await mongoose.connection
      .collection("features")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection.collection("features").insertOne({
      id: "guarded-flag",
      organization: ORG_ID,
      valueType: "boolean",
      defaultValue: "false",
      version: 1,
      holdout: { id: "hld_1", value: "control" },
      environmentSettings: { production: { enabled: false, rules: [] } },
      dateCreated: new Date(Date.now() - 60_000),
      dateUpdated: new Date(Date.now() - 60_000),
    });
  });

  async function load() {
    const feature = await getFeature(context, "guarded-flag");
    if (!feature) throw new Error("seed missing");
    return feature;
  }

  it("removes the holdout and applies content in one guarded write", async () => {
    const preImage = await load();
    const updated = await updateFeature(
      context,
      preImage,
      { defaultValue: "true" },
      { casOnDateUpdated: preImage.dateUpdated, unsetHoldout: true },
    );
    expect(updated.defaultValue).toBe("true");
    expect(updated.holdout).toBeUndefined();
    // The token advanced strictly past the pre-image's.
    expect(updated.dateUpdated.getTime()).toBeGreaterThan(
      preImage.dateUpdated.getTime(),
    );
  });

  it("refuses a stale pre-image and leaves the winner's write whole", async () => {
    const preImage = await load();
    await updateFeature(context, preImage, { defaultValue: "winner" });

    await expect(
      updateFeature(
        context,
        preImage,
        { defaultValue: "loser" },
        { casOnDateUpdated: preImage.dateUpdated, unsetHoldout: true },
      ),
    ).rejects.toBeInstanceOf(CasConflictError);

    const after = await load();
    expect(after.defaultValue).toBe("winner");
    // The refused write's $unset must not have applied either — one write, so
    // a lost race loses ALL of it.
    expect(after.holdout).toBeDefined();
  });
});
