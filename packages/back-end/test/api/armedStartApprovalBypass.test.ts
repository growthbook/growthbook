import request from "supertest";
import mongoose from "mongoose";
import type { NextFunction, Request, Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyInterface } from "shared/types/apikey";
import { ReqContextClass } from "back-end/src/services/context";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { maybePublishScheduledRevision } from "back-end/src/api/features/autoPublishOnApproval";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { logger } from "back-end/src/util/logger";
import { postApproveScheduledExperimentStart } from "back-end/src/controllers/experiments";
import {
  postFeatureScheduledPublish,
  postFeatureToggleAutoPublish,
} from "back-end/src/controllers/features";
import {
  asKey,
  asUser,
  auditContext,
  checklistRefusal,
  dashboardReq,
  EXP_ID,
  experiments,
  fire,
  HOUR,
  insertExperiment,
  insertFlag,
  keyDoc,
  org,
  ORG_ID,
  organizations,
  resSpy,
  revisions,
  seedOrg,
  staged,
  status,
} from "./scheduledStart.fixture";
import { setupApp } from "./api.setup";

const FLAG = "flag_bypass";

const reviewOrg = {
  ...org,
  settings: {
    ...org.settings,
    requireReviews: [
      {
        requireReviewOn: true,
        resetReviewOnChange: true,
        autopublishOnApproval: true,
        environments: [],
        projects: [],
      },
    ],
  },
} as unknown as OrganizationInterface;

const adminKey = keyDoc("key_admin", "admin");
const experimenterKey = keyDoc("key_exp", "experimenter");
const heldKey = keyDoc("key_held", "admin", {
  confirmRules: [{ actions: ["override.bypassApproval"] }],
} as Partial<ApiKeyInterface>);

const arms = [
  { variationId: "0", value: "false" },
  { variationId: "1", value: "true" },
];
const expRule = {
  type: "experiment-ref",
  id: "fr_exp",
  description: "",
  experimentId: EXP_ID,
  enabled: true,
  allEnvironments: true,
  variations: arms,
};
const forceRule = {
  type: "force",
  description: "",
  value: "true",
  enabled: true,
  allEnvironments: true,
};

// The flag's draft (version 2) and a draft experiment it's queued on.
async function seed({
  draftStatus = "pending-review",
  draftRules = [expRule] as object[],
  schedule = true,
  orgDoc = reviewOrg,
  flagProject = "",
}: {
  draftStatus?: string;
  draftRules?: object[];
  schedule?: boolean;
  orgDoc?: OrganizationInterface;
  flagProject?: string;
} = {}) {
  await seedOrg(orgDoc);
  await mongoose.connection
    .collection("apikeys")
    .insertMany([adminKey, experimenterKey, heldKey].map((k) => ({ ...k })));
  await insertFlag(FLAG, draftStatus, draftRules, flagProject);
  await insertExperiment({
    linkedFeatures: [FLAG],
    pendingFeatureDrafts: draftRules.includes(expRule)
      ? [{ featureId: FLAG, revisionVersion: 2 }]
      : [],
    ...(schedule
      ? { statusUpdateSchedule: { startAt: new Date(Date.now() + HOUR) } }
      : {}),
  });
}

const draftQuery = { organization: ORG_ID, featureId: FLAG, version: 2 };
const draft = async () => revisions().findOne(draftQuery);
const updateDraft = (fields: Record<string, unknown>) =>
  revisions().updateOne(draftQuery, { $set: fields });
// Arms the draft to publish at `at`, as its owner did.
const armDraft = (at: Date, fields: Record<string, unknown> = {}) =>
  updateDraft({
    autoPublishOnApproval: true,
    autoPublishEnabledBy: "u_owner",
    scheduledPublishAt: at,
    ...fields,
  });

type ApproveReq = Parameters<typeof postApproveScheduledExperimentStart>[0];
const approve = async (userId: string, body: Record<string, unknown>) => {
  const { res, captured } = resSpy();
  const req = dashboardReq<ApproveReq>(body, { userId, orgDoc: reviewOrg });
  await postApproveScheduledExperimentStart(req, res);
  return { captured, req };
};
const refusedOnApproval = (featureId: string) =>
  checklistRefusal(`pendingApproval:${featureId}`);
// Fires the armed start and expects it held back for a retry on featureId's approval.
async function fireRefusedOnApproval(featureId: string) {
  const errors = jest.spyOn(logger, "error").mockImplementation();

  await fire();

  expect(await status()).toBe("draft");
  expect((await draft())?.status).toBe("pending-review");
  expect(await staged()).toMatchObject({ type: "start", failedAttempts: 1 });
  expect(errors).toHaveBeenCalledWith(
    expect.objectContaining(refusedOnApproval(featureId)),
    expect.stringContaining("Failed to update experiment status"),
  );
}

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
    ).rejects.toMatchObject(refusedOnApproval(FLAG));
    await expect(
      approve("u_exp", { skipChecklist: true, bypassApproval: true }),
    ).rejects.toMatchObject(refusedOnApproval(FLAG));
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
    expect(auditContext(req)).toMatchObject({ bypassLockdown: true });

    await fire();

    expect(await status()).toBe("running");
    expect((await draft())?.status).toBe("published");
  });

  it("needs the approval after all once the pinned draft changes", async () => {
    await seed();
    await approve("u_owner", { skipChecklist: true, bypassApproval: true });
    await updateDraft({ dateUpdated: new Date(Date.now() + 1000) });

    await fireRefusedOnApproval(FLAG);
  });

  it("needs the approval after all for a draft queued after it was armed", async () => {
    await seed();
    await approve("u_owner", { skipChecklist: true, bypassApproval: true });
    await insertFlag("flag_later", "pending-review", [expRule]);
    await experiments().updateOne({ id: EXP_ID }, {
      $push: {
        linkedFeatures: "flag_later",
        pendingFeatureDrafts: { featureId: "flag_later", revisionVersion: 2 },
      },
    } as object);

    await fireRefusedOnApproval("flag_later");
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

    await fireRefusedOnApproval(FLAG);
  });
});

describe("a REST scheduled start past a flag draft's approval", () => {
  const start = () =>
    auth(request(app).post(`/api/v1/experiments/${EXP_ID}/start`)).send({
      skipChecklist: true,
    });

  it("arms an admin key by its authority, and fires as the key", async () => {
    await seed();
    setReqContext(asKey(adminKey, reviewOrg));

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

  it("reports what a start now bypassed and published", async () => {
    await seed({ schedule: false });
    setReqContext(asKey(adminKey, reviewOrg));

    const res = await start();

    expect(res.status).toBe(200);
    expect(res.body.bypassedGates).toContainEqual({
      key: `pendingApproval:${FLAG}`,
      type: "approval-required",
      outcome: "bypassed",
      via: "bypassApprovalPermission",
    });
    expect(res.body.publishedFeatureDrafts).toEqual([
      expect.objectContaining({ featureId: FLAG }),
    ]);
  });

  it("refuses a key without bypass authority", async () => {
    await seed();
    setReqContext(asKey(experimenterKey, reviewOrg));

    const refused = await start();
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "checklist_incomplete" });
    expect(await staged()).toBeNull();
  });

  it.each([
    { kind: "scheduled", schedule: true },
    { kind: "immediate", schedule: false },
  ])(
    "holds a $kind start that waives an approval as an approval bypass",
    async ({ schedule }) => {
      await seed({ schedule });
      setReqContext(asKey(heldKey, reviewOrg));

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
    await seed({ orgDoc: org });
    setReqContext(asKey(heldKey, org));

    expect((await start()).status).toBe(200);
    expect(await staged()).toMatchObject({ scheduledByApiKey: "key_held" });
  });
});

describe("a flag draft that would take a draft experiment live", () => {
  const later = () => new Date(Date.now() + HOUR).toISOString();
  const launchRefusal = /draft experiment "Checkout test"/;

  it("can't be armed to publish later from REST", async () => {
    await seed({ draftStatus: "draft" });
    setReqContext(asKey(adminKey, reviewOrg));

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
          { scheduledPublishAt: later(), bypassApproval: true },
          { orgDoc: reviewOrg, params },
        ),
        resSpy().res,
      ),
    ).rejects.toThrow(launchRefusal);
    await expect(
      postFeatureToggleAutoPublish(
        dashboardReq<ToggleReq>(
          { enabled: true },
          { orgDoc: reviewOrg, params },
        ),
        resSpy().res,
      ),
    ).rejects.toThrow(launchRefusal);
    expect((await draft())?.autoPublishOnApproval).toBeFalsy();
  });

  it("disarms an armed draft when an edit adds the experiment's rule", async () => {
    await seed({ draftStatus: "draft", draftRules: [] });
    await armDraft(new Date(Date.now() + HOUR));
    setReqContext(asUser("u_owner", reviewOrg));

    const added = await auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/2/rules`),
    ).send({
      rule: {
        type: "experiment-ref",
        experimentId: EXP_ID,
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
    await armDraft(new Date(Date.now() - 1000), {
      scheduledPublishBypassApproval: true,
    });
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
    await armDraft(at, { scheduledPublishBypassApproval: true });
    setReqContext(asUser("u_owner", reviewOrg));

    const added = await auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/2/rules`),
    ).send({ rule: forceRule });

    expect(added.status).toBe(200);
    const after = await draft();
    expect(after?.scheduledPublishBypassApproval).toBeUndefined();
    expect(after?.autoPublishOnApproval).toBe(true);
    expect(after?.scheduledPublishAt).toEqual(at);
  });
});
