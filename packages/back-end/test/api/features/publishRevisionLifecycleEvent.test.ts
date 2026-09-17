import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureInterface } from "shared/types/feature";
import { ReqContextClass } from "back-end/src/services/context";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import {
  createInitialRevision,
  createRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { setupApp } from "../api.setup";

function makeOrg(id: string): OrganizationInterface {
  return {
    id,
    name: id,
    ownerEmail: "test@test.com",
    url: "",
    dateCreated: new Date(),
    members: [],
    settings: {
      environments: [{ id: "production", description: "" }],
    },
  } as unknown as OrganizationInterface;
}

function makeContext(org: OrganizationInterface): ReqContextClass {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query: {}, headers: {} } as unknown as Request,
  });
}

async function seedFeature(
  context: ReqContextClass,
  featureId: string,
): Promise<FeatureInterface> {
  await mongoose.connection.collection("features").insertOne({
    id: featureId,
    organization: context.org.id,
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
  const feature = await getFeature(context, featureId);
  if (!feature) throw new Error("seed feature missing");
  await createInitialRevision(context, feature, context.auditUser, [
    "production",
  ]);
  return feature;
}

function publishedEvents(orgId: string, version: number) {
  return mongoose.connection
    .collection("events")
    .find({
      organizationId: orgId,
      event: "feature.revision.published",
      "data.data.object.version": version,
    })
    .toArray();
}

/**
 * The app's kill switch, ramp-schedule steps, safe-rollout rollbacks and
 * experiment-start draft publishes all land through the model-level publish
 * with no handler dispatching `revision.published` afterwards. Subscribers
 * mirror live state from that event, so the landing itself owes it.
 */
describe("publishRevision lifecycle event", () => {
  const { app, setReqContext } = setupApp();

  // The kill switch's exact shape: a draft carrying only an environment flip,
  // published straight away.
  it("emits feature.revision.published for a landing no handler dispatches", async () => {
    const org = makeOrg("org_publish_lifecycle");
    const context = makeContext(org);
    const featureId = "feat_publish_lifecycle";
    const feature = await seedFeature(context, featureId);

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
      org,
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
      .findOne({ organization: org.id, id: featureId });
    expect(live?.environmentSettings?.production?.enabled).toBe(false);
    const stored = await mongoose.connection
      .collection("featurerevisions")
      .findOne({
        organization: org.id,
        featureId,
        version: revision.version,
      });
    expect(stored?.status).toBe("published");

    const published = await publishedEvents(org.id, revision.version);
    expect(published).toHaveLength(1);
    expect(published[0].data?.data?.object).toMatchObject({
      featureId,
      version: revision.version,
      status: "published",
    });
  });

  // The REST update handler lands through createAndPublishRevision and once
  // dispatched this event itself. Exactly one guards against the landing and a
  // handler both emitting.
  it("emits exactly one feature.revision.published for a handler that lands through publishRevision", async () => {
    const org = makeOrg("org_publish_lifecycle_rest");
    const context = makeContext(org);
    setReqContext(context);
    const featureId = "feat_publish_lifecycle_rest";
    await seedFeature(context, featureId);

    const updated = await request(app)
      .post(`/api/v1/features/${featureId}`)
      .send({ defaultValue: "true" })
      .set("Authorization", "Bearer x");
    if (updated.status !== 200) {
      throw new Error(
        `update failed: ${updated.status} ${JSON.stringify(updated.body)}`,
      );
    }
    expect(updated.body.feature.revision.version).toBe(2);

    expect(await publishedEvents(org.id, 2)).toHaveLength(1);
  });
});
