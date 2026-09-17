import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import {
  createInitialRevision,
  createRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api.setup";

const ORG = {
  id: "org_publish_lifecycle",
  name: "Publish Lifecycle",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [{ id: "production", description: "" }],
  },
} as unknown as OrganizationInterface;

const FEATURE_ID = "feat_publish_lifecycle";

/**
 * Twelve callers land feature revisions through the model-level publish with no
 * handler dispatching `revision.published` afterwards: the app's kill switch,
 * ramp-schedule steps, safe-rollout rollbacks, experiment-start draft publishes.
 * The lifecycle event is what subscribers mirror live state from, so the landing
 * itself owes it. This drives the kill switch's exact shape: a draft carrying only
 * an environment flip, published straight away.
 */
describe("publishRevision lifecycle event", () => {
  setupApp();

  it("emits feature.revision.published for a landing no handler dispatches", async () => {
    const context = new ReqContextClass({
      org: ORG,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    await mongoose.connection.collection("features").insertOne({
      id: FEATURE_ID,
      organization: ORG.id,
      version: 1,
      defaultValue: "false",
      valueType: "boolean",
      owner: "",
      description: "",
      project: "",
      tags: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      rules: [],
      environmentSettings: { production: { enabled: true, rules: [] } },
      archived: false,
    });
    const feature = await getFeature(context, FEATURE_ID);
    if (!feature) throw new Error("seed feature missing");
    await createInitialRevision(context, feature, context.auditUser, [
      "production",
    ]);

    const toggles = { production: false };
    const revision = await createRevision({
      context,
      feature,
      user: context.auditUser,
      baseVersion: feature.version,
      comment: "Toggle production off",
      environments: ["production"],
      publish: false,
      changes: { environmentsEnabled: toggles },
      org: ORG,
    });
    await publishRevision({
      context,
      feature,
      revision,
      result: { environmentsEnabled: toggles },
      bypassLockdown: true,
    });

    const live = await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG.id, id: FEATURE_ID });
    expect(live?.environmentSettings?.production?.enabled).toBe(false);
    const stored = await mongoose.connection
      .collection("featurerevisions")
      .findOne({
        organization: ORG.id,
        featureId: FEATURE_ID,
        version: revision.version,
      });
    expect(stored?.status).toBe("published");

    const published = await mongoose.connection
      .collection("events")
      .find({ organizationId: ORG.id, event: "feature.revision.published" })
      .toArray();
    expect(published).toHaveLength(1);
    expect(published[0].data?.data?.object).toMatchObject({
      featureId: FEATURE_ID,
      version: revision.version,
      status: "published",
    });
  });
});
