import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

/**
 * A verdict belongs to the review cycle it was formed against.
 *
 * Status cannot identify a cycle. Recall returns the row to `draft`; a resubmit
 * puts it back at `pending-review` — the same value it held when the reviewer
 * opened it. So a verdict aimed at the RETRACTED cycle satisfies every status
 * check and lands on the new one, approving content nobody reviewed and, if the
 * revision is armed, publishing it. Classic ABA: the guard watches a value that
 * returns to what it was.
 *
 * `reviewCycle` is the identity the guard was missing. It is bumped by every action
 * that starts a cycle, and a verdict names the cycle its author read.
 *
 * The bare-`draft` case is covered separately (verdictOutsideReviewCycle); this is
 * specifically the round trip BACK to a legal status, which that test cannot see.
 */

const ORG_ID = "org_review_aba";
const org = {
  id: ORG_ID,
  name: "Review ABA",
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

describe("a verdict cannot cross a recall/resubmit cycle", () => {
  setupApp();

  const REV_ID = "rev_review_aba";

  const context = () => {
    const c = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    c.hasPremiumFeature = () => true;
    return c;
  };

  const seed = async (reviewCycle?: number) => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: "cst_aba",
      organization: ORG_ID,
      key: "cst_aba",
      name: "cst_aba",
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
      status: "pending-review",
      authorId: "u_author",
      reviews: [],
      activityLog: [],
      contributors: [],
      ...(reviewCycle === undefined ? {} : { reviewCycle }),
      target: {
        type: "constant",
        id: "cst_aba",
        snapshot: { id: "cst_aba", key: "cst_aba", project: "" },
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

  it("refuses a verdict formed against a superseded cycle", async () => {
    await seed(1);
    // The recall-and-resubmit that happened while the reviewer was deciding. The
    // row is back at `pending-review` — indistinguishable from cycle 1 by status —
    // but it is a different request now.
    await mongoose.connection
      .collection("revisions")
      .updateOne(
        { organization: ORG_ID, id: REV_ID },
        { $set: { reviewCycle: 2 } },
      );

    await expect(
      context().models.revisions.addReview(
        REV_ID,
        "u_reviewer",
        "approve",
        "",
        {
          authorizedByFlow:
            "test fixture: authority covered by the case under test",
        },
        1,
      ),
    ).rejects.toThrow(/superseded/i);

    const row = await stored();
    expect(row?.status).toBe("pending-review");
    expect(row?.reviews).toEqual([]);
  });

  it("accepts a verdict formed against the current cycle", async () => {
    // The control: cycle 2's own reviewer must still be able to approve, or the
    // guard has simply broken reviewing.
    await seed(2);

    await context().models.revisions.addReview(
      REV_ID,
      "u_reviewer",
      "approve",
      "",
      {
        authorizedByFlow:
          "test fixture: authority covered by the case under test",
      },
      2,
    );

    expect((await stored())?.status).toBe("approved");
  });

  it("treats a revision with no cycle field as cycle 0", async () => {
    // Revisions predating the field must stay reviewable — a guard that locked
    // them out would be a worse bug than the one it fixes.
    await seed(undefined);

    await context().models.revisions.addReview(
      REV_ID,
      "u_reviewer",
      "approve",
      "",
      {
        authorizedByFlow:
          "test fixture: authority covered by the case under test",
      },
      0,
    );

    expect((await stored())?.status).toBe("approved");
  });

  it("lets a comment through regardless of cycle", async () => {
    // Comments belong to the conversation, not to a cycle, and they change no
    // status — so they are deliberately exempt.
    await seed(2);

    await context().models.revisions.addReview(
      REV_ID,
      "u_reviewer",
      "comment",
      "still thinking",
      {
        authorizedByFlow:
          "test fixture: authority covered by the case under test",
      },
      1,
    );

    const row = await stored();
    expect(row?.status).toBe("pending-review");
    expect((row?.reviews as unknown[]).length).toBe(1);
  });

  it("bumps the cycle on recall, so the next request is a new one", async () => {
    // The other half: the guard is only as good as the bump that feeds it. If
    // recall stopped stamping a new cycle, the first case above would pass
    // vacuously — its two cycle numbers would simply never diverge in real use.
    await seed(1);
    await context().models.revisions.recallReview(REV_ID, "u_author", {
      authorizedByFlow:
        "test fixture: authority covered by the case under test",
    });

    expect((await stored())?.reviewCycle).toBe(2);
  });
});
