import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { submitBodySchema } from "back-end/src/routers/revision/revision.router";
import { postSubmit } from "back-end/src/routers/revision/revision.controller";
import { setupApp } from "../api/api.setup";

// The controller builds its own context via `getContextFromReq`, so the usual
// `context.hasPremiumFeature = () => true` seam isn't reachable from here.
// MUTABLE rather than a constant `true`: the scheduling gate's unique
// contribution IS the premium check, so an always-licensed fixture cannot tell
// the gate from its publish-authority neighbour.
let hasScheduledRevisions = true;
jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  orgHasPremiumFeature: (_org: unknown, feature: string) =>
    feature === "scheduled-revisions" ? hasScheduledRevisions : true,
}));

/**
 * The submit ROUTE, at the two layers above the model (which
 * `submitForReviewSchedule.test.ts` covers directly):
 *  - the SCHEMA, asserted against the very object the router mounts — the strict
 *    body schema 400s any undeclared key in middleware, before the model;
 *  - the CONTROLLER, driven directly, where the three arming gates live.
 */

const ORG_ID = "org_submit_route";
const org = {
  id: ORG_ID,
  name: "Submit Route",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
    // Draft authority WITHOUT publish: may submit for review, may not commit a
    // future publish. The discriminator for the scheduling gate — an admin holds
    // both, so deleting that gate changes nothing an admin can observe.
    {
      id: "u_drafter",
      role: "flag_drafter",
      limitAccessByEnvironment: false,
      environments: [],
    },
    // Publish authority, but only in `dev`. Passes the COARSE adapter check (a
    // Constant declares no environment binding, so that check is unbound) and fails
    // the CHANGE-AWARE re-assert on a revision touching production — the only
    // caller that can tell those two gates apart.
    {
      id: "u_dev_publisher",
      role: "flag_publisher",
      limitAccessByEnvironment: true,
      environments: ["dev"],
    },
  ],
  customRoles: [
    {
      id: "flag_drafter",
      description: "Draft authority only",
      policies: ["ReadData", "FlagsEditDrafts"],
    },
    {
      id: "flag_publisher",
      description: "Draft + publish",
      policies: ["ReadData", "FlagsEditDrafts", "FlagsPublish"],
    },
  ],
  settings: { environments: [{ id: "dev" }, { id: "production" }] },
} as unknown as OrganizationInterface;

describe("POST /revision/:id/submit — the body schema", () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

  it("accepts the staged schedule the front-end sends", () => {
    const res = submitBodySchema.safeParse({
      autoPublishOnApproval: false,
      scheduledPublishAt: tomorrow,
      scheduledPublishLockEdits: true,
      scheduledPublishLockOthers: true,
    });
    expect(res.success).toBe(true);
  });

  it("still accepts a plain submit, and still rejects a genuinely unknown key", () => {
    // The canary: declaring the fields must not have loosened the schema to
    // passthrough, which would let anything through and make the case above
    // pass for the wrong reason.
    expect(submitBodySchema.safeParse({}).success).toBe(true);
    expect(submitBodySchema.safeParse({ notAField: true }).success).toBe(false);
  });
});

describe("POST /revision/:id/submit — the controller's arming gates", () => {
  setupApp();

  const REV_ID = "rev_submit_route";

  const reqFor = (body: Record<string, unknown>, userId = "u_admin") =>
    ({
      params: { id: REV_ID },
      body,
      organization: org,
      userId,
      email: "a@t.co",
      name: "A",
      query: {},
      headers: {},
    }) as unknown as Parameters<typeof postSubmit>[0];

  const resSpy = () => {
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
  };

  beforeEach(async () => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: "cst_route",
      organization: ORG_ID,
      key: "cst_route",
      name: "cst_route",
      type: "string",
      value: "v",
      owner: "",
      project: "",
      environmentValues: { dev: "old", production: "old" },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await mongoose.connection.collection("revisions").insertOne({
      id: REV_ID,
      organization: ORG_ID,
      version: 2,
      status: "draft",
      authorId: "u_admin",
      reviews: [],
      activityLog: [],
      contributors: [],
      target: {
        type: "constant",
        id: "cst_route",
        snapshot: {
          id: "cst_route",
          key: "cst_route",
          project: "",
          environmentValues: { dev: "old", production: "old" },
        },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  });

  const stored = async () =>
    mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });

  it("arms the staged schedule end to end", async () => {
    const when = new Date(Date.now() + 86_400_000);
    const { res, captured } = resSpy();
    await postSubmit(
      reqFor({
        scheduledPublishAt: when.toISOString(),
        scheduledPublishLockEdits: true,
        scheduledPublishLockOthers: false,
      }),
      res,
    );

    expect(captured.status).toBe(200);
    const doc = await stored();
    expect({
      status: doc?.status,
      armed: doc?.autoPublishOnApproval,
      at: doc?.scheduledPublishAt?.toISOString?.(),
      lockEdits: doc?.scheduledPublishLockEdits,
    }).toEqual({
      status: "pending-review",
      armed: true,
      at: when.toISOString(),
      lockEdits: true,
    });
  });

  it("refuses a past date and arms nothing", async () => {
    const { res, captured } = resSpy();
    await postSubmit(
      reqFor({
        scheduledPublishAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      res,
    );

    expect(captured.status).toBe(400);
    // The revision must not have transitioned either — a 400 that still moved the
    // draft to pending-review would be worse than the rejection it reports.
    const doc = await stored();
    expect({ status: doc?.status, armed: doc?.autoPublishOnApproval }).toEqual({
      status: "draft",
      armed: undefined,
    });
  });

  it("refuses an unparseable date and arms nothing", async () => {
    const { res, captured } = resSpy();
    await postSubmit(reqFor({ scheduledPublishAt: "not-a-date" }), res);

    expect(captured.status).toBe(400);
    expect((await stored())?.status).toBe("draft");
  });

  it("refuses a DATE when the org is not licensed for scheduled publishes", async () => {
    // The gate's own contribution. This caller holds publish, so the
    // `assertCanPublishRevision` re-assert below it passes — only the premium half
    // can refuse here.
    hasScheduledRevisions = false;
    try {
      const { res } = resSpy();
      await expect(
        postSubmit(
          reqFor({
            scheduledPublishAt: new Date(Date.now() + 86_400_000).toISOString(),
          }),
          res,
        ),
      ).rejects.toThrow(/permission/i);
      expect((await stored())?.status).toBe("draft");
    } finally {
      hasScheduledRevisions = true;
    }
  });

  it("refuses a DATE from a caller who may submit but not publish", async () => {
    // The scheduling gate specifically: this caller passes `canAdvanceRevision`
    // (draft authority) and so submits fine below, but arming a future publish is
    // publish-class and must be refused. Without a caller who holds one and not the
    // other, deleting the gate is unobservable.
    const { res } = resSpy();
    await expect(
      postSubmit(
        reqFor(
          {
            scheduledPublishAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
          "u_drafter",
        ),
        res,
      ),
    ).rejects.toThrow(/permission/i);
    expect((await stored())?.status).toBe("draft");
  });

  it("lets that same caller submit without a date", async () => {
    const { res, captured } = resSpy();
    await postSubmit(reqFor({}, "u_drafter"), res);
    expect(captured.status).toBe(200);
    expect((await stored())?.status).toBe("pending-review");
  });

  // The change-aware `assertCanPublishRevision` re-assert. These use a TOP-LEVEL
  // `/environmentValues` replace: the authority side reads ops through
  // `applyTopLevelPatchOps`, and nested paths are rejected at the validator —
  // see `nestedPatchAuthority.test.ts`.
  it("refuses a DATE whose changes reach an environment the caller lacks", async () => {
    // The coarse adapter gate cannot see the change set, so only a caller who
    // passes that and fails this one tells them apart.
    await mongoose.connection.collection("revisions").updateOne(
      { organization: ORG_ID, id: REV_ID },
      {
        $set: {
          "target.proposedChanges": [
            {
              op: "replace",
              path: "/environmentValues",
              value: { dev: "old", production: "prod-only" },
            },
          ],
        },
      },
    );

    const { res } = resSpy();
    await expect(
      postSubmit(
        reqFor(
          {
            scheduledPublishAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
          "u_dev_publisher",
        ),
        res,
      ),
    ).rejects.toThrow(/permission/i);
    expect((await stored())?.status).toBe("draft");
  });

  it("allows that caller a DATE when the changes stay in dev", async () => {
    // The other half: the re-assert must NARROW, not refuse outright.
    await mongoose.connection.collection("revisions").updateOne(
      { organization: ORG_ID, id: REV_ID },
      {
        $set: {
          "target.proposedChanges": [
            {
              op: "replace",
              path: "/environmentValues",
              value: { dev: "dev-only", production: "old" },
            },
          ],
        },
      },
    );

    const { res, captured } = resSpy();
    await postSubmit(
      reqFor(
        { scheduledPublishAt: new Date(Date.now() + 86_400_000).toISOString() },
        "u_dev_publisher",
      ),
      res,
    );
    expect(captured.status).toBe(200);
    expect((await stored())?.autoPublishOnApproval).toBe(true);
  });

  it("submits normally when no date is sent", async () => {
    // The positive control for all three gates above: they must not refuse the
    // ordinary submit, which is the path everyone actually takes.
    const { res, captured } = resSpy();
    await postSubmit(reqFor({}), res);

    expect(captured.status).toBe(200);
    const doc = await stored();
    expect({
      status: doc?.status,
      at: doc?.scheduledPublishAt ?? null,
      lockEdits: doc?.scheduledPublishLockEdits ?? null,
    }).toEqual({ status: "pending-review", at: null, lockEdits: null });
  });
});
