import request from "supertest";
import mongoose from "mongoose";
import type { NextFunction, Request, Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyInterface } from "shared/types/apikey";
import { ReqContextClass } from "back-end/src/services/context";
import { updateSingleExperimentStatus } from "back-end/src/jobs/updateExperimentStatus";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { maybePublishScheduledRevision } from "back-end/src/api/features/autoPublishOnApproval";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  postApproveScheduledExperimentStart,
  postExperiment,
} from "back-end/src/controllers/experiments";
import {
  postFeatureScheduledPublish,
  postFeatureToggleAutoPublish,
} from "back-end/src/controllers/features";
import { setupApp } from "./api.setup";

// A start armed past its flag drafts' approvals carries an admin's bypass to
// when it fires, for the drafts as they were armed. A flag draft that would take
// a draft experiment live can't be armed on the flag side, since its publish
// would leave the experiment unstarted. Drives the real routes, controllers,
// Mongo documents, and jobs.

const ORG_ID = "org_bypass";
const EXP = "exp_bypass";
const FLAG = "flag_bypass";
const HOUR = 60 * 60 * 1000;

const reviews = {
  requireReviews: [
    {
      requireReviewOn: true,
      resetReviewOnChange: true,
      autopublishOnApproval: true,
      environments: [],
      projects: [],
    },
  ],
};
const org = {
  id: ORG_ID,
  name: "Bypass",
  ownerEmail: "owner@test.com",
  url: "",
  dateCreated: new Date(),
  members: [
    ["u_owner", "admin"],
    ["u_exp", "experimenter"],
  ].map(([id, role]) => ({
    id,
    role,
    environments: [],
    limitAccessByEnvironment: false,
    projectRoles: [],
  })),
  settings: { environments: [{ id: "production" }], ...reviews },
} as unknown as OrganizationInterface;

const keyDoc = (
  id: string,
  role: string,
  extra: Partial<ApiKeyInterface> = {},
) =>
  ({
    id,
    organization: ORG_ID,
    key: `secret_${id}`,
    secret: true,
    description: id,
    role,
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...extra,
  }) as unknown as ApiKeyInterface;
const adminKey = keyDoc("key_admin", "admin");
const experimenterKey = keyDoc("key_exp", "experimenter");
const heldKey = keyDoc("key_held", "admin", {
  confirmRules: [{ actions: ["override.bypassApproval"] }],
} as Partial<ApiKeyInterface>);

const experiments = () => mongoose.connection.collection("experiments");
const revisions = () => mongoose.connection.collection("featurerevisions");
const organizations = () => mongoose.connection.collection("organizations");

const arms = [
  { variationId: "0", value: "false" },
  { variationId: "1", value: "true" },
];
const expRule = {
  type: "experiment-ref",
  id: "fr_exp",
  description: "",
  experimentId: EXP,
  enabled: true,
  allEnvironments: true,
  variations: arms,
};
const forceRule = {
  type: "force",
  id: "fr_force",
  description: "",
  value: "true",
  enabled: true,
  allEnvironments: true,
};

function asUser(id: string) {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "dashboard", id, email: `${id}@test.com`, name: id },
    user: { id, email: `${id}@test.com`, name: id },
    teams: [],
  });
  context.hasPremiumFeature = () => true;
  return context;
}

function asKey(key: ApiKeyInterface, orgDoc = org) {
  const context = new ReqContextClass({
    org: orgDoc,
    auditUser: { type: "api_key", apiKey: key.id, name: key.description },
    role: key.role,
    apiKey: key.id,
    apiKeyData: key,
    teams: [],
  });
  context.hasPremiumFeature = () => true;
  return context;
}

// A flag with its published version 1 and draft version 2.
async function insertFlag(
  id: string,
  draftStatus: string,
  draftRules: object[],
  project = "",
) {
  const now = new Date();
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    project,
    owner: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    dateCreated: now,
    dateUpdated: now,
  });
  const revision = (version: number, status: string, rules: object[]) => ({
    id: `frev_${id}_${version}`,
    organization: ORG_ID,
    featureId: id,
    version,
    baseVersion: 1,
    status,
    createdBy: {
      type: "dashboard",
      id: "u_owner",
      email: "u_owner@test.com",
      name: "u_owner",
    },
    comment: "",
    defaultValue: "false",
    rules,
    environmentsEnabled: { production: true },
    dateCreated: now,
    dateUpdated: now,
    ...(status === "published" ? { datePublished: now } : {}),
  });
  await revisions().insertMany([
    revision(1, "published", []),
    revision(2, draftStatus, draftRules),
  ]);
}

// The flag's draft (version 2) and a draft experiment it's queued on.
async function seed({
  draftStatus = "pending-review",
  draftRules = [expRule] as object[],
  schedule = true,
  orgSettings = org.settings,
  flagProject = "",
}: {
  draftStatus?: string;
  draftRules?: object[];
  schedule?: boolean;
  orgSettings?: object;
  flagProject?: string;
} = {}) {
  const now = new Date();
  await organizations().insertOne({ ...org, settings: orgSettings });
  await mongoose.connection.collection("users").insertMany(
    ["u_owner", "u_exp"].map((id) => ({
      id,
      email: `${id}@test.com`,
      name: id,
    })),
  );
  await mongoose.connection
    .collection("apikeys")
    .insertMany([adminKey, experimenterKey, heldKey].map((k) => ({ ...k })));
  await insertFlag(FLAG, draftStatus, draftRules, flagProject);
  await experiments().insertOne({
    id: EXP,
    organization: ORG_ID,
    trackingKey: EXP,
    name: "Checkout test",
    type: "standard",
    owner: "u_owner",
    project: "",
    hypothesis: "",
    description: "",
    tags: [],
    dateCreated: now,
    dateUpdated: now,
    archived: false,
    status: "draft",
    autoSnapshots: false,
    hashAttribute: "id",
    hashVersion: 2,
    variations: [
      { id: "0", key: "0", name: "Control", screenshots: [] },
      { id: "1", key: "1", name: "Variation", screenshots: [] },
    ],
    phases: [
      {
        dateStarted: now,
        name: "Main",
        reason: "",
        coverage: 1,
        condition: "",
        savedGroups: [],
        namespace: { enabled: false, name: "", range: [0, 1] },
        variationWeights: [0.5, 0.5],
      },
    ],
    linkedFeatures: [FLAG],
    pendingFeatureDrafts: draftRules.some((r) => r === expRule)
      ? [{ featureId: FLAG, revisionVersion: 2 }]
      : [],
    ...(schedule
      ? { statusUpdateSchedule: { startAt: new Date(Date.now() + HOUR) } }
      : {}),
    datasource: "",
    exposureQueryId: "",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    decisionFrameworkSettings: {},
    implementation: "code",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    ideaSource: "",
    releasedVariationId: "",
  });
}

const staged = async () =>
  (await experiments().findOne({ id: EXP }))?.nextScheduledStatusUpdate ?? null;
const status = async () => (await experiments().findOne({ id: EXP }))?.status;
const draft = async (version = 2) =>
  revisions().findOne({ organization: ORG_ID, featureId: FLAG, version });
const fireNow = () =>
  experiments().updateOne(
    { id: EXP },
    { $set: { "nextScheduledStatusUpdate.date": new Date(Date.now() - 1000) } },
  );
const fire = async () => {
  await fireNow();
  await updateSingleExperimentStatus({
    attrs: { data: { experimentId: EXP, organization: ORG_ID } },
  } as unknown as Parameters<typeof updateSingleExperimentStatus>[0]);
};

function dashboardReq<T>(
  userId: string,
  body: Record<string, unknown>,
  params: Record<string, string> = { id: EXP },
): T {
  return {
    params,
    body,
    organization: org,
    userId,
    email: `${userId}@test.com`,
    name: userId,
    query: {},
    headers: {},
    audit: jest.fn(),
  } as unknown as T;
}
function resSpy() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}
type ApproveReq = Parameters<typeof postApproveScheduledExperimentStart>[0];
const approve = async (userId: string, body: Record<string, unknown>) => {
  const { res, captured } = resSpy();
  const req = dashboardReq<ApproveReq>(userId, body);
  await postApproveScheduledExperimentStart(req, res);
  return { captured, req };
};
const refusedOnApproval = {
  code: "checklist_incomplete",
  details: {
    remainingChecklistItems: expect.arrayContaining([
      expect.objectContaining({ key: `pendingApproval:${FLAG}` }),
    ]),
  },
};

const { app, isReady, setReqContext } = setupApp();
const auth = (req: request.Test) => req.set("Authorization", "Bearer foo");

// Production builds the context from the real request, which a confirmation
// hold reads; give the harness's prebuilt context that request too.
beforeAll(async () => {
  await isReady;
  const mocked = jest.requireMock<{ default: jest.Mock }>(
    "back-end/src/middleware/authenticateApiRequestMiddleware",
  ).default;
  const inner = mocked.getMockImplementation();
  mocked.mockImplementation(
    (
      req: Request & { context: ReqContextClass },
      res: Response,
      next: NextFunction,
    ) =>
      inner?.(req, res, () => {
        req.context.req = req;
        next();
      }),
  );
});

// Approvals and schedules are paid features, including for the contexts the
// jobs build for themselves.
beforeEach(() => {
  jest
    .spyOn(ReqContextClass.prototype, "hasPremiumFeature")
    .mockReturnValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("a dashboard scheduled start armed past its flag draft's approval", () => {
  it("is refused without the bypass, and to an experimenter who asks for it", async () => {
    await seed();

    await expect(
      approve("u_owner", { skipChecklist: true }),
    ).rejects.toMatchObject(refusedOnApproval);
    await expect(
      approve("u_exp", { skipChecklist: true, bypassApproval: true }),
    ).rejects.toMatchObject(refusedOnApproval);
    expect(await staged()).toBeFalsy();
  });

  it("arms an admin's bypass with the draft pinned, and publishes the draft when it fires", async () => {
    await seed();
    const pinned = (await draft())?.dateUpdated;

    const { captured, req } = await approve("u_owner", {
      skipChecklist: true,
      bypassApproval: true,
    });
    expect(captured.status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledBy: "u_owner",
      bypassApproval: true,
      pinnedDrafts: [
        { featureId: FLAG, revisionVersion: 2, dateUpdated: pinned },
      ],
    });
    const audited = JSON.parse(
      (
        (req as unknown as { audit: jest.Mock }).audit.mock.calls[0][0] as {
          details: string;
        }
      ).details,
    ).context;
    expect(audited).toMatchObject({ bypassLockdown: true });

    await fire();

    expect(await status()).toBe("running");
    expect((await draft())?.status).toBe("published");
  });

  it("needs the approval after all once the pinned draft changes", async () => {
    await seed();
    await approve("u_owner", { skipChecklist: true, bypassApproval: true });
    await revisions().updateOne(
      { organization: ORG_ID, featureId: FLAG, version: 2 },
      { $set: { dateUpdated: new Date(Date.now() + 1000) } },
    );

    await fire();

    expect(await status()).toBe("draft");
    expect((await draft())?.status).toBe("pending-review");
    expect(await staged()).toMatchObject({ type: "start", failedAttempts: 1 });
  });

  it("needs the approval after all for a draft queued after it was armed", async () => {
    await seed();
    await approve("u_owner", { skipChecklist: true, bypassApproval: true });
    await insertFlag("flag_later", "pending-review", [expRule]);
    await experiments().updateOne({ id: EXP }, {
      $push: {
        linkedFeatures: "flag_later",
        pendingFeatureDrafts: { featureId: "flag_later", revisionVersion: 2 },
      },
    } as object);

    await fire();

    expect(await status()).toBe("draft");
    expect((await draft())?.status).toBe("pending-review");
  });

  it("needs the approval after all once the armer can't bypass on the experiment", async () => {
    // Still an admin in the flag's project, so only the experiment's own
    // permission stands in the way.
    await seed({ flagProject: "proj_flag" });
    await approve("u_owner", { skipChecklist: true, bypassApproval: true });
    await organizations().updateOne(
      { id: ORG_ID, "members.id": "u_owner" },
      {
        $set: {
          "members.$.role": "experimenter",
          "members.$.projectRoles": [
            {
              project: "proj_flag",
              role: "admin",
              environments: [],
              limitAccessByEnvironment: false,
            },
          ],
        },
      },
    );

    await fire();

    expect(await status()).toBe("draft");
    expect((await draft())?.status).toBe("pending-review");
  });

  it("needs the approval after all once the armer can no longer bypass", async () => {
    await seed();
    await approve("u_owner", { skipChecklist: true, bypassApproval: true });
    await organizations().updateOne(
      { id: ORG_ID, "members.id": "u_owner" },
      { $set: { "members.$.role": "experimenter" } },
    );

    await fire();

    expect(await status()).toBe("draft");
    expect((await draft())?.status).toBe("pending-review");
  });
});

describe("a REST scheduled start past a flag draft's approval", () => {
  const start = () =>
    auth(request(app).post(`/api/v1/experiments/${EXP}/start`)).send({
      skipChecklist: true,
    });

  it("arms an admin key by its authority, and fires as the key", async () => {
    await seed();
    setReqContext(asKey(adminKey));

    expect((await start()).status).toBe(200);
    expect(await staged()).toMatchObject({
      scheduledByApiKey: "key_admin",
      bypassApproval: true,
      pinnedDrafts: [expect.objectContaining({ featureId: FLAG })],
    });

    await fire();

    expect(await status()).toBe("running");
    expect((await draft())?.status).toBe("published");
  });

  it("refuses a key without bypass authority", async () => {
    await seed();
    setReqContext(asKey(experimenterKey));

    const refused = await start();
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "checklist_incomplete" });
    expect(await staged()).toBeNull();
  });

  it.each([
    ["scheduled", true],
    ["immediate", false],
  ])(
    "holds a %s start that waives an approval as an approval bypass",
    async (_kind, schedule) => {
      await seed({ schedule });
      setReqContext(asKey(heldKey));

      const held = await start();

      expect(held.status).toBe(202);
      expect(
        held.body.confirmation.actions.map(
          ({ action }: { action: string }) => action,
        ),
      ).toContain("override.bypassApproval");
      expect(await status()).toBe("draft");
      expect(await staged()).toBeNull();
    },
  );

  it("doesn't hold as a bypass when no approval is waiting", async () => {
    const settings = { environments: [{ id: "production" }] };
    await seed({ orgSettings: settings });
    setReqContext(
      asKey(heldKey, { ...org, settings } as unknown as OrganizationInterface),
    );

    expect((await start()).status).toBe(200);
    expect(await staged()).toMatchObject({ scheduledByApiKey: "key_held" });
  });
});

describe("a scheduled start's experiment", () => {
  const armed = async () => {
    await seed();
    setReqContext(asKey(adminKey));
    await auth(request(app).post(`/api/v1/experiments/${EXP}/start`)).send({
      skipChecklist: true,
    });
    expect(await staged()).toMatchObject({ type: "start" });
  };
  const update = (body: object) =>
    auth(request(app).post(`/api/v1/experiments/${EXP}`)).send(body);

  it("refuses a REST change to what it launches, and stays scheduled", async () => {
    await armed();

    const refused = await update({ hashAttribute: "deviceId" });

    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/hashAttribute.*start is scheduled/);
    expect((await experiments().findOne({ id: EXP }))?.hashAttribute).toBe(
      "id",
    );
    expect(await staged()).toMatchObject({ type: "start" });
  });

  it("takes a REST change to its metadata", async () => {
    await armed();

    expect((await update({ description: "Why it matters" })).status).toBe(200);
    expect(await staged()).toMatchObject({ type: "start" });
  });

  it("refuses new Visual Editor changes from REST", async () => {
    await armed();

    const refused = await auth(
      request(app).post(`/api/v1/experiments/${EXP}/visual-changesets`),
    ).send({
      editorUrl: "https://example.com/",
      urlPatterns: [{ type: "simple", pattern: "/", include: true }],
    });

    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/Visual Editor changes/);
  });

  it("refuses a dashboard coverage change", async () => {
    await armed();
    type UpdateReq = Parameters<typeof postExperiment>[0];

    await expect(
      postExperiment(
        dashboardReq<UpdateReq>("u_owner", { coverage: 0.5 }),
        resSpy().res,
      ),
    ).rejects.toThrow(/coverage.*start is scheduled/);
    expect((await experiments().findOne({ id: EXP }))?.phases[0].coverage).toBe(
      1,
    );
  });
});

describe("a flag draft that would take a draft experiment live", () => {
  const later = () => new Date(Date.now() + HOUR).toISOString();
  const launchRefusal = /draft experiment "Checkout test"/;

  it("can't be armed to publish later from REST", async () => {
    await seed({ draftStatus: "draft" });
    setReqContext(asKey(adminKey));

    const scheduled = await auth(
      request(app).post(
        `/api/v2/features/${FLAG}/revisions/2/schedule-publish`,
      ),
    ).send({ scheduledPublishAt: later(), bypassApproval: true });
    expect(scheduled.status).toBe(400);
    expect(scheduled.body.message).toMatch(launchRefusal);

    const reviewed = await auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/2/request-review`),
    ).send({ autoPublishOnApproval: true });
    expect(reviewed.status).toBe(400);
    expect(reviewed.body.message).toMatch(launchRefusal);

    expect(await draft()).toMatchObject({ status: "draft" });
    expect((await draft())?.autoPublishOnApproval).toBeFalsy();
  });

  it("can't be armed to publish later from the dashboard", async () => {
    await seed();
    const params = { id: FLAG, version: "2" };
    type ScheduleReq = Parameters<typeof postFeatureScheduledPublish>[0];
    type ToggleReq = Parameters<typeof postFeatureToggleAutoPublish>[0];

    await expect(
      postFeatureScheduledPublish(
        dashboardReq<ScheduleReq>(
          "u_owner",
          { scheduledPublishAt: later(), bypassApproval: true },
          params,
        ),
        resSpy().res,
      ),
    ).rejects.toThrow(launchRefusal);
    await expect(
      postFeatureToggleAutoPublish(
        dashboardReq<ToggleReq>("u_owner", { enabled: true }, params),
        resSpy().res,
      ),
    ).rejects.toThrow(launchRefusal);
    expect((await draft())?.autoPublishOnApproval).toBeFalsy();
  });

  it("disarms an armed draft when an edit adds the experiment's rule", async () => {
    await seed({ draftStatus: "draft", draftRules: [] });
    await revisions().updateOne(
      { organization: ORG_ID, featureId: FLAG, version: 2 },
      {
        $set: {
          autoPublishOnApproval: true,
          autoPublishEnabledBy: "u_owner",
          scheduledPublishAt: new Date(Date.now() + HOUR),
        },
      },
    );
    setReqContext(asUser("u_owner"));

    const added = await auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/2/rules`),
    ).send({
      rule: {
        type: "experiment-ref",
        experimentId: EXP,
        variations: arms,
        allEnvironments: true,
      },
    });

    expect(added.status).toBe(200);
    const after = await draft();
    expect(after?.autoPublishOnApproval).toBe(false);
    expect(after?.scheduledPublishAt).toBeUndefined();
  });

  it("fails an armed publish for good when it fires, even with the admin bypass", async () => {
    await seed({ draftStatus: "draft" });
    await revisions().updateOne(
      { organization: ORG_ID, featureId: FLAG, version: 2 },
      {
        $set: {
          autoPublishOnApproval: true,
          autoPublishEnabledBy: "u_owner",
          scheduledPublishAt: new Date(Date.now() - 1000),
          scheduledPublishBypassApproval: true,
        },
      },
    );
    const context = await getContextForAgendaJobByOrgId(ORG_ID);
    const feature = await getFeature(context, FLAG);
    const revision = await getRevision({
      context,
      organization: ORG_ID,
      featureId: FLAG,
      feature: feature ?? undefined,
      version: 2,
    });

    await maybePublishScheduledRevision(context, feature!, revision!);

    const after = await draft();
    expect(after?.status).toBe("draft");
    expect(after?.scheduledPublishGaveUpAt).toBeInstanceOf(Date);
    expect(after?.scheduledPublishLastError).toMatch(launchRefusal);
    expect(await status()).toBe("draft");
  });
});

describe("a gated edit to a flag draft armed with the admin bypass", () => {
  it("drops the bypass and keeps the schedule", async () => {
    await seed({ draftStatus: "draft", draftRules: [] });
    const at = new Date(Date.now() + HOUR);
    await revisions().updateOne(
      { organization: ORG_ID, featureId: FLAG, version: 2 },
      {
        $set: {
          autoPublishOnApproval: true,
          autoPublishEnabledBy: "u_owner",
          scheduledPublishAt: at,
          scheduledPublishBypassApproval: true,
        },
      },
    );
    setReqContext(asUser("u_owner"));

    const added = await auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/2/rules`),
    ).send({ rule: { ...forceRule, id: undefined } });

    expect(added.status).toBe(200);
    const after = await draft();
    expect(after?.scheduledPublishBypassApproval).toBeUndefined();
    expect(after?.autoPublishOnApproval).toBe(true);
    expect(after?.scheduledPublishAt).toEqual(at);
  });
});
