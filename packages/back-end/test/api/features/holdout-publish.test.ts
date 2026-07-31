import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { canLinkExperimentToHoldoutFromFeatures } from "back-end/src/services/holdouts";
import { getHoldoutAvailableForProject } from "back-end/src/services/holdout-availability";
import { setupApp } from "../api.setup";

// Coverage for the headline behaviors of the holdout-publish fixes:
//  1. Publishing a holdout change no longer needs `createAnalyses`. The linkage
//     back-reference on the Holdout is a side effect of an authorized flag
//     publish, so an engineer (FeaturesFullAccess, no HoldoutsFullAccess) must
//     be able to complete it — it used to throw mid-publish, after the feature
//     document had already advanced, stranding the flag.
//  2. Adding an experiment rule to a holdout-bound flag likewise does not need
//     permission to edit the holdout's other fields.
//  3. A stranded live revision (feature.version === revision.version, still a
//     draft, diffs empty) publishes: the revision closes as published and the
//     feature version does NOT advance again.
//  4. That same revision cannot be discarded — discarding it would leave the
//     feature serving a revision that reports as never published.

const ORG_ID = "org_holdout_publish";

const org = {
  id: ORG_ID,
  name: "Holdout Publish",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [{ id: "production" }],
  },
} as unknown as OrganizationInterface;

// Engineer: FeaturesFullAccess + SDKPayloadPublish + ReadData, but NOT
// HoldoutsFullAccess — so `canUpdateHoldout` (createAnalyses) is false while
// every flag publish permission passes. Exactly the role shape that used to
// fail mid-publish.
function makeContext(
  role: "engineer" | "experimenter" = "engineer",
): ReqContextClass {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_engineer" },
    role,
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  context.hasPremiumFeature = () => true;
  return context;
}

async function insertFeature(
  id: string,
  version = 1,
  holdout?: { id: string; value: string },
  project = "",
): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    owner: "",
    description: "",
    project,
    valueType: "boolean",
    defaultValue: "false",
    version,
    archived: false,
    tags: [],
    rules: [],
    ...(holdout ? { holdout } : {}),
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: now,
    dateUpdated: now,
  });
}

async function insertExperiment(id: string, project = ""): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("experiments").insertOne({
    id,
    organization: ORG_ID,
    project,
    projects: [],
    trackingKey: id,
    name: id,
    type: "standard",
    hypothesis: "",
    description: "",
    tags: [],
    owner: "",
    status: "draft",
    archived: false,
    variations: [
      {
        id: "v0",
        key: "0",
        name: "Control",
        description: "",
        screenshots: [],
      },
      {
        id: "v1",
        key: "1",
        name: "Variation",
        description: "",
        screenshots: [],
      },
    ],
    phases: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    linkedFeatures: [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    customFields: {},
    dateCreated: now,
    dateUpdated: now,
  });
}

async function insertHoldout(
  id: string,
  projects: string[] = [],
): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("experiments").insertOne({
    id: `exp_${id}`,
    organization: ORG_ID,
    project: "",
    trackingKey: id,
    name: `${id} holdout experiment`,
    status: "running",
    archived: false,
    variations: [],
    phases: [],
    dateCreated: now,
    dateUpdated: now,
  });
  await mongoose.connection.collection("holdouts").insertOne({
    id,
    organization: ORG_ID,
    name: id,
    projects,
    experimentId: `exp_${id}`,
    linkedExperiments: {},
    linkedFeatures: {},
    environmentSettings: { production: { enabled: true, rules: [] } },
    dateCreated: now,
    dateUpdated: now,
  });
}

async function insertRevision(
  featureId: string,
  version: number,
  status: "published" | "draft",
): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("featurerevisions").insertOne({
    id: `frev_${featureId}_${version}`,
    organization: ORG_ID,
    featureId,
    version,
    baseVersion: Math.max(version - 1, 0),
    status,
    createdBy: { type: "api_key", apiKey: "key_engineer" },
    comment: "",
    defaultValue: "false",
    rules: [],
    dateCreated: now,
    dateUpdated: now,
    ...(status === "published" ? { datePublished: now } : {}),
  });
}

// The feature is live on version 2 but that revision was never marked published
// — the stranded shape a mid-publish throw used to leave behind.
async function insertStrandedFeature(featureId: string): Promise<void> {
  await insertFeature(featureId, 2);
  await insertRevision(featureId, 1, "published");
  await insertRevision(featureId, 2, "draft");
}

describe("holdout publish", () => {
  const { app, setReqContext } = setupApp();

  it("publishes a holdout change for a role without createAnalyses and writes the linkage", async () => {
    const context = makeContext();
    setReqContext(context);
    // The relaxation is what makes this pass; assert the role really lacks
    // holdout-update authority so the test can't silently stop covering it.
    expect(context.permissions.canUpdateHoldout({ projects: [] }, {})).toBe(
      false,
    );

    await insertFeature("flag_holdout_link");
    await insertRevision("flag_holdout_link", 1, "published");
    await insertHoldout("hld_link_target");

    const setRes = await request(app)
      .put("/api/v2/features/flag_holdout_link/revisions/new/holdout")
      .send({ holdout: { id: "hld_link_target", value: "false" } })
      .set("Authorization", "Bearer foo");
    expect(setRes.status).toBe(200);
    const version = setRes.body.revision.version;

    const publishRes = await request(app)
      .post(`/api/v2/features/flag_holdout_link/revisions/${version}/publish`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(publishRes.status).toBe(200);

    const holdout = await mongoose.connection
      .collection("holdouts")
      .findOne({ id: "hld_link_target" });
    expect(holdout?.linkedFeatures?.flag_holdout_link).toBeTruthy();

    const feature = await mongoose.connection
      .collection("features")
      .findOne({ id: "flag_holdout_link" });
    expect(feature?.holdout?.id).toBe("hld_link_target");
  });

  it("adds an experiment rule to a holdout-bound feature without holdout access", async () => {
    const context = makeContext("experimenter");
    jest.spyOn(context.permissions, "canUpdateHoldout").mockReturnValue(false);
    jest
      .spyOn(context.permissions, "canReadMultiProjectResource")
      .mockImplementation(
        (projects) => !projects.includes("project_without_access"),
      );
    setReqContext(context);

    await insertHoldout("hld_existing", [
      "project_with_access",
      "project_without_access",
    ]);
    await insertFeature(
      "flag_existing_holdout",
      1,
      {
        id: "hld_existing",
        value: "false",
      },
      "project_with_access",
    );
    await insertRevision("flag_existing_holdout", 1, "published");
    await insertRevision("flag_existing_holdout", 2, "draft");
    await insertExperiment("exp_new", "project_with_access");
    expect(
      await canLinkExperimentToHoldoutFromFeatures(context, "hld_existing", [
        "flag_existing_holdout",
      ]),
    ).toBe(true);
    expect(
      await canLinkExperimentToHoldoutFromFeatures(context, "hld_existing", [
        "missing_feature",
      ]),
    ).toBe(false);
    await expect(
      getHoldoutAvailableForProject({
        context,
        holdoutId: "hld_existing",
        project: "project_with_access",
        bypassReadPermissionChecks: true,
      }),
    ).resolves.toMatchObject({ id: "hld_existing" });
    await expect(
      getHoldoutAvailableForProject({
        context,
        holdoutId: "hld_existing",
        project: "unavailable_project",
        bypassReadPermissionChecks: true,
      }),
    ).rejects.toThrow(/not available in the selected Project/);

    const res = await request(app)
      .post("/api/v1/features/flag_existing_holdout/revisions/2/rules")
      .send({
        environment: "production",
        rule: {
          type: "experiment-ref",
          condition: "",
          experimentId: "exp_new",
          variations: [
            { variationId: "v0", value: "false" },
            { variationId: "v1", value: "true" },
          ],
        },
      })
      .set("Authorization", "Bearer foo");

    expect(res.status).toBe(200);

    // Nothing is linked yet: an abandoned draft must leave no enrollment behind.
    const draftExperiment = await mongoose.connection
      .collection("experiments")
      .findOne({ id: "exp_new" });
    expect(draftExperiment?.holdoutId ?? "").toBe("");
    const draftHoldout = await mongoose.connection
      .collection("holdouts")
      .findOne({ id: "hld_existing" });
    expect(draftHoldout?.linkedExperiments?.exp_new).toBeFalsy();

    const publishRes = await request(app)
      .post("/api/v1/features/flag_existing_holdout/revisions/2/publish")
      .send({})
      .set("Authorization", "Bearer foo");
    expect(publishRes.status).toBe(200);

    // Publishing links it, still without holdout access.
    const experiment = await mongoose.connection
      .collection("experiments")
      .findOne({ id: "exp_new" });
    expect(experiment?.holdoutId).toBe("hld_existing");
    const holdout = await mongoose.connection
      .collection("holdouts")
      .findOne({ id: "hld_existing" });
    expect(holdout?.linkedExperiments?.exp_new).toBeTruthy();
  });

  it("publishing a stranded live revision closes it without advancing the feature version", async () => {
    setReqContext(makeContext());
    await insertStrandedFeature("flag_stranded");

    const publishRes = await request(app)
      .post("/api/v2/features/flag_stranded/revisions/2/publish")
      .send({})
      .set("Authorization", "Bearer foo");
    expect(publishRes.status).toBe(200);

    const revision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: "flag_stranded", version: 2 });
    expect(revision?.status).toBe("published");

    const feature = await mongoose.connection
      .collection("features")
      .findOne({ id: "flag_stranded" });
    expect(feature?.version).toBe(2);
  });

  it("refuses to discard the revision the feature is live on", async () => {
    setReqContext(makeContext());
    await insertStrandedFeature("flag_no_discard");

    const res = await request(app)
      .post("/api/v2/features/flag_no_discard/revisions/2/discard")
      .send({})
      .set("Authorization", "Bearer foo");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/live version of the Feature Flag/);

    const revision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: "flag_no_discard", version: 2 });
    expect(revision?.status).toBe("draft");
  });
});
