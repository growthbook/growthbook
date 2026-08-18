import type { Revision } from "shared/types/revision";
import { revisionApprovalsCoverChange } from "back-end/src/revisions/revisionActions";
import type { Context } from "back-end/src/models/BaseModel";

const context = (memberEnvs: string[] | null): Context =>
  ({
    org: {
      id: "org_1",
      settings: {
        environments: [{ id: "dev" }, { id: "staging" }, { id: "production" }],
      },
      customRoles: [
        {
          id: "reviewer",
          description: "review only",
          policies: ["FlagsReview"],
        },
      ],
      members: [
        {
          id: "u_rev",
          role: "reviewer",
          limitAccessByEnvironment: memberEnvs !== null,
          environments: memberEnvs ?? [],
        },
      ],
    },
    teams: [],
  }) as unknown as Context;

const constant = {
  id: "const_1",
  key: "flag_limit",
  value: "10",
  environmentValues: { dev: "1", production: "2" },
  archived: false,
};

const revision = (
  changedEnvValues: Record<string, string>,
  reviews: { userId: string; decision: string; stale?: boolean }[],
): Revision =>
  ({
    status: "approved",
    reviews,
    target: {
      type: "constant",
      snapshot: constant,
      proposedChanges: [
        {
          op: "replace",
          path: "/environmentValues",
          value: changedEnvValues,
        },
      ],
    },
  }) as unknown as Revision;

const approvedByReviewer = [{ userId: "u_rev", decision: "approve" }];

describe("standing approvals on a generic revision", () => {
  it("counts an approval that covers the changed environment", () => {
    const r = revision({ dev: "5", production: "2" }, approvedByReviewer);

    expect(
      revisionApprovalsCoverChange(context(["dev"]), r).hasCoveringApproval,
    ).toBe(true);
  });

  // The bypass this closes: approved while dev-only, then production changed too.
  it("discounts it once the change grows past the approver", () => {
    const r = revision({ dev: "5", production: "6" }, approvedByReviewer);
    const result = revisionApprovalsCoverChange(context(["dev"]), r);

    expect(result.hasCoveringApproval).toBe(false);
    expect(result.uncoveredApprovers).toEqual(["u_rev"]);
  });

  it("requires unrestricted authority for an unbound change", () => {
    // A base value carries no environment binding.
    const r = {
      ...revision({ dev: "1", production: "2" }, approvedByReviewer),
    } as Revision;
    (r.target as { proposedChanges: unknown }).proposedChanges = [
      { op: "replace", path: "/value", value: "99" },
    ];

    expect(
      revisionApprovalsCoverChange(context(["dev"]), r).hasCoveringApproval,
    ).toBe(false);
    expect(
      revisionApprovalsCoverChange(context(null), r).hasCoveringApproval,
    ).toBe(true);
  });

  it("ignores a stale verdict", () => {
    const r = revision({ dev: "5", production: "2" }, [
      { userId: "u_rev", decision: "approve", stale: true },
    ]);

    expect(
      revisionApprovalsCoverChange(context(["dev"]), r).hasCoveringApproval,
    ).toBe(false);
  });

  it("ignores a change-request verdict", () => {
    const r = revision({ dev: "5", production: "2" }, [
      { userId: "u_rev", decision: "requestChanges" },
    ]);

    expect(
      revisionApprovalsCoverChange(context(["dev"]), r).hasCoveringApproval,
    ).toBe(false);
  });
});
