import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

/**
 * The generic engine's approval reset is judged on the write itself: the
 * revision as approved against what the write makes it. An edit that adds a
 * gated change to an approved dev-only Constant revision must send it back for
 * review, and one that touches nothing gated must not.
 */

const ORG_ID = "org_approved_revision_edit_reset";
const org = {
  id: ORG_ID,
  name: "Approved Revision Edit Reset",
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
  ],
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "production", description: "" },
    ],
    requireReviews: [
      {
        requireReviewOn: true,
        resetReviewOnChange: true,
        environments: ["production"],
        projects: [],
      },
    ],
  },
} as unknown as OrganizationInterface;

const REV_ID = "rev_approved_edit_reset";
const snapshot = {
  id: "cst_reset",
  organization: ORG_ID,
  key: "cst_reset",
  name: "cst_reset",
  type: "string",
  value: "base",
  environmentValues: { dev: "d0", production: "p0" },
  owner: "",
  project: "",
  dateCreated: new Date("2024-01-01"),
  dateUpdated: new Date("2024-01-01"),
};
const devOnly = [
  {
    op: "replace" as const,
    path: "/environmentValues",
    value: { dev: "d1", production: "p0" },
  },
];

describe("editing an approved Constant revision", () => {
  setupApp();
  let context: ReqContextClass;

  const seed = async () => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      ...snapshot,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await mongoose.connection.collection("revisions").insertOne({
      id: REV_ID,
      organization: ORG_ID,
      version: 2,
      status: "approved",
      authorId: "u_admin",
      reviews: [
        {
          id: "review_1",
          userId: "u_reviewer",
          decision: "approve",
          dateCreated: new Date("2024-01-02"),
        },
      ],
      reviewCycle: 1,
      activityLog: [],
      contributors: ["u_admin"],
      target: {
        type: "constant",
        id: "cst_reset",
        snapshot,
        proposedChanges: devOnly,
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  };

  const stored = async () =>
    mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });

  const authority = { authorizedByFlow: "test" };

  beforeEach(async () => {
    await seed();
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    // The reset is licensed like publish-time review is.
    context.hasPremiumFeature = () => true;
  });

  it("adding a production override sends it back for review and opens a new cycle", async () => {
    await context.models.revisions.updateProposedChanges(
      REV_ID,
      [
        {
          op: "replace",
          path: "/environmentValues",
          value: { dev: "d1", production: "p1" },
        },
      ],
      "u_admin",
      authority,
    );

    const doc = await stored();
    expect(doc?.status).toBe("pending-review");
    expect(doc?.reviews?.[0]?.stale).toBe(true);
    expect(doc?.reviewCycle).toBe(2);
    expect(
      (doc?.activityLog as { action: string }[]).map((e) => e.action),
    ).toContain("reopened");
  });

  it("an edit outside the gate keeps the approval", async () => {
    await context.models.revisions.updateProposedChanges(
      REV_ID,
      [...devOnly, { op: "replace", path: "/name", value: "renamed" }],
      "u_admin",
      authority,
    );

    const doc = await stored();
    expect(doc?.status).toBe("approved");
    expect(doc?.reviews?.[0]?.stale ?? false).toBe(false);
    expect(doc?.reviewCycle).toBe(1);
  });

  it("a rebase is judged on what the draft still changes against the new live", async () => {
    // Live moved production upstream; the draft's own change is still dev only.
    const rebased = {
      ...snapshot,
      environmentValues: { dev: "d0", production: "p9" },
    };
    await context.models.revisions.rebase(
      REV_ID,
      rebased,
      [
        {
          op: "replace",
          path: "/environmentValues",
          value: { dev: "d1", production: "p9" },
        },
      ],
      "u_admin",
      authority,
    );
    expect((await stored())?.status).toBe("approved");

    // Rebased onto a live where the draft now also differs in production.
    await context.models.revisions.rebase(
      REV_ID,
      rebased,
      [
        {
          op: "replace",
          path: "/environmentValues",
          value: { dev: "d1", production: "p1" },
        },
      ],
      "u_admin",
      authority,
    );
    expect((await stored())?.status).toBe("pending-review");
  });
});
