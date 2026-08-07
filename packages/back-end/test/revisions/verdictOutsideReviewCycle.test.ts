import mongoose from "mongoose";
import type { Response, Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { postReview } from "back-end/src/routers/revision/revision.controller";
import { setupApp } from "../api/api.setup";

/**
 * A verdict must not land on a revision that has left the review cycle.
 *
 * The CAS re-check refused only the TERMINAL statuses — merged and discarded —
 * which still admits `draft`. A recall landing between the caller's read and this
 * write therefore had the retracted cycle's verdict apply anyway, and because the
 * new status is computed from the row's own reviews, a `draft` nobody had asked to
 * be reviewed came back as `approved`.
 *
 * The caller's own pre-check can't cover this: it reads a copy that the recall has
 * already superseded by the time the write runs. Only the check inside the CAS,
 * against the row the write is conditioned on, can.
 *
 * These drive the model through the controller with the revision ALREADY in
 * `draft`, which is the state a winning recall leaves behind — the same row the
 * losing verdict's CAS retry would read. The controller's own refusal answers
 * first, so the assertions below pin the response; the last case reaches past it,
 * straight to the model, to prove the CAS guard is the one really holding.
 */

const ORG_ID = "org_verdict_cycle";
const org = {
  id: ORG_ID,
  name: "Verdict Cycle",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_reviewer",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: {},
} as unknown as OrganizationInterface;

describe("a verdict is refused outside the review cycle", () => {
  setupApp();

  const REV_ID = "rev_verdict_cycle";

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

  const review = async (decision: string) => {
    const { res, captured } = resSpy();
    await postReview(
      {
        params: { id: REV_ID },
        // The author is someone else, so the self-review guard doesn't fire first
        // and hide what is being tested.
        body: { decision },
        organization: org,
        userId: "u_reviewer",
        email: "r@t.co",
        name: "R",
        query: {},
        headers: {},
      } as unknown as Parameters<typeof postReview>[0],
      res,
    );
    return captured;
  };

  const seed = async (status: string) => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: "cst_cycle",
      organization: ORG_ID,
      key: "cst_cycle",
      name: "cst_cycle",
      type: "string",
      value: "v",
      owner: "",
      project: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await mongoose.connection.collection("revisions").insertOne({
      id: REV_ID,
      organization: ORG_ID,
      version: 2,
      status,
      authorId: "u_author",
      reviews: [],
      activityLog: [],
      contributors: [],
      target: {
        type: "constant",
        id: "cst_cycle",
        snapshot: { id: "cst_cycle", key: "cst_cycle", project: "" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  };

  const stored = async () =>
    await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });

  it("refuses an approval on a recalled (draft) revision", async () => {
    await seed("draft");
    const captured = await review("approve");

    expect(captured.status).not.toBe(200);
    const row = await stored();
    // Neither half may land: not the status, and not the verdict that would let a
    // later reconcile compute it.
    expect(row?.status).toBe("draft");
    expect(row?.reviews).toEqual([]);
  });

  it("refuses a request-changes on a recalled (draft) revision", async () => {
    await seed("draft");
    const captured = await review("request-changes");

    expect(captured.status).not.toBe(200);
    const row = await stored();
    expect(row?.status).toBe("draft");
    expect(row?.reviews).toEqual([]);
  });

  it("still accepts a COMMENT on a draft", async () => {
    // The control, and the reason the guard is scoped to non-comment decisions:
    // comments carry no verdict and leave the status alone, and commenting on a
    // draft is ordinary. Refusing everything would pass both cases above.
    await seed("draft");
    const captured = await review("comment");

    expect(captured.status).toBe(200);
    const row = await stored();
    expect(row?.status).toBe("draft");
    expect((row?.reviews as unknown[]).length).toBe(1);
  });

  it("still accepts an approval while review IS requested", async () => {
    // The other control: the ordinary path must keep working.
    await seed("pending-review");
    const captured = await review("approve");

    expect(captured.status).toBe(200);
    expect((await stored())?.status).toBe("approved");
  });

  it("the MODEL refuses too, which is the half that closes the race", async () => {
    // The controller reads the row, then the model writes it — and a recall
    // landing in between is exactly the case no pre-check can see. Seed
    // `pending-review` so the controller's check passes, then move the row to
    // `draft` before the write, standing in for the recall that won.
    await seed("pending-review");
    await mongoose.connection
      .collection("revisions")
      .updateOne(
        { organization: ORG_ID, id: REV_ID },
        { $set: { status: "draft" } },
      );

    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    await expect(
      context.models.revisions.addReview(REV_ID, "u_reviewer", "approve", ""),
    ).rejects.toThrow(/review has been requested/i);

    const row = await stored();
    expect(row?.status).toBe("draft");
    expect(row?.reviews).toEqual([]);
  });
});
