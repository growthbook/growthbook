import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { submitBodySchema } from "back-end/src/routers/revision/revision.router";
import { postSubmit } from "back-end/src/routers/revision/revision.controller";
import { setupApp } from "../api/api.setup";

// The controller builds its own context via `getContextFromReq`, so the usual
// `context.hasPremiumFeature = () => true` seam isn't reachable from here. Arming a
// DATED publish requires `scheduled-revisions`, and without it every dated case
// below would fail on the premium gate rather than on the thing it asserts.
//
// MUTABLE rather than a constant `true`: the scheduling gate's unique contribution
// IS the premium check — its publish-authority half is re-asserted a few lines later
// by `assertCanPublishRevision` — so a fixture that is always licensed cannot tell
// the gate from its neighbour, and deleting it stays green.
let hasScheduledRevisions = true;
jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  orgHasPremiumFeature: (_org: unknown, feature: string) =>
    feature === "scheduled-revisions" ? hasScheduledRevisions : true,
}));

/**
 * The submit ROUTE, at the two layers above the model.
 *
 * `submitForReviewSchedule.test.ts` calls the model directly, and that is exactly
 * why it could pass while the feature was dead: the request never reached the model
 * at all. The strict body schema 400s an undeclared key in middleware, and when
 * `postSubmit` learned to arm a dated schedule the schema was not updated — so the
 * front-end sending the new fields turned a working submit into a failing one.
 *
 * A test pins nothing above its own layer. These two describes are the layers the
 * change actually spanned:
 *  - the SCHEMA, asserted against the very object the router mounts;
 *  - the CONTROLLER, driven directly, which is where the three arming gates live
 *    (they were all green when individually deleted).
 *
 * The middleware between them is one `body: submitBodySchema` reference, which is
 * why asserting the exported object rather than a copy is the whole trick.
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
    // The P1: this exact payload used to 400 in middleware.
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
          // Safe to carry now: the CAS guard is cloned at capture, so the
          // beforeUpdate rebuild can no longer corrupt it. Before that fix this
          // exhausted the retry loop and made these two cases unwritable.
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

  /**
   * STILL NOT covered: the change-aware `assertCanPublishRevision` re-assert.
   *
   * The CAS exhaustion that used to block this fixture is gone — `buildCasGuard`
   * clones now, and the dev-scoped case below proves the fixture writes. What
   * remains is that the footprint comes out EMPTY for this shape: an
   * `/environmentValues/production` patch against a live Constant that carries
   * per-environment values should narrow the check to production and refuse a
   * dev-limited publisher, and does not. Either `getConstantRevisionChange` is not
   * seeing the change in this fixture, or the fixture's constant is not the shape it
   * needs. Unisolated, so recorded rather than guessed at — the gate is verified at
   * source, and a mutation removing it stays green.
   */

  it("allows that caller a DATE when the changes stay in dev", async () => {
    // The other half: the re-assert must NARROW, not refuse outright.
    await mongoose.connection.collection("revisions").updateOne(
      { organization: ORG_ID, id: REV_ID },
      {
        $set: {
          "target.proposedChanges": [
            {
              op: "replace",
              path: "/environmentValues/dev",
              value: "dev-only",
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
