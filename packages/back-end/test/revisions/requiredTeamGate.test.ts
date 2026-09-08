import type { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { revisionRequiredApproverTeams } from "back-end/src/revisions/revisionActions";

// The publish gate refuses when this reports unsatisfied and the caller cannot
// bypass, so these cases stand in for the refusal itself.
const buildRevision = (
  reviews: { userId: string; decision: string; stale?: boolean }[],
): Revision =>
  ({
    id: "rev-1",
    target: {
      type: "saved-group",
      id: "sg-1",
      snapshot: { projects: ["prj-1"] },
      proposedChanges: [{ op: "replace", path: "/values", value: ["c"] }],
    },
    status: "pending-review",
    authorId: "author",
    reviews,
    activityLog: [],
    organization: "org-1",
  }) as unknown as Revision;

function makeContext(members: { id: string; teams?: string[] }[]): Context {
  return {
    org: {
      members,
      settings: {
        approvalFlows: {
          savedGroups: [
            {
              projects: ["prj-1"],
              required: true,
              requiredApproverTeams: ["team_fin"],
            },
          ],
        },
      },
    },
    teams: [{ id: "team_fin", name: "Finance" }],
    hasPremiumFeature: () => true,
  } as unknown as Context;
}

describe("revisionRequiredApproverTeams", () => {
  const noneUncovered = { uncoveredApprovers: [] };

  it("is unsatisfied when the approver is not on the named team", () => {
    const result = revisionRequiredApproverTeams(
      makeContext([{ id: "u1", teams: [] }]),
      buildRevision([{ userId: "u1", decision: "approve" }]),
      noneUncovered,
    );

    expect(result.satisfied).toBe(false);
    expect(result.unmet).toEqual([[{ id: "team_fin", name: "Finance" }]]);
  });

  it("is satisfied once a member of the named team approves", () => {
    const result = revisionRequiredApproverTeams(
      makeContext([{ id: "u1", teams: ["team_fin"] }]),
      buildRevision([{ userId: "u1", decision: "approve" }]),
      noneUncovered,
    );

    expect(result.satisfied).toBe(true);
  });

  // A stale approval is not a standing one, so it cannot satisfy the team.
  it("ignores a stale approval", () => {
    const result = revisionRequiredApproverTeams(
      makeContext([{ id: "u1", teams: ["team_fin"] }]),
      buildRevision([{ userId: "u1", decision: "approve", stale: true }]),
      noneUncovered,
    );

    expect(result.satisfied).toBe(false);
  });

  // Coverage comes first: an approval that does not span the change cannot be
  // recycled to tick the team box.
  it("ignores an approval whose authority does not cover the change", () => {
    const result = revisionRequiredApproverTeams(
      makeContext([{ id: "u1", teams: ["team_fin"] }]),
      buildRevision([{ userId: "u1", decision: "approve" }]),
      { uncoveredApprovers: ["u1"] },
    );

    expect(result.satisfied).toBe(false);
  });

  it("is unsatisfied when nobody has approved yet", () => {
    const result = revisionRequiredApproverTeams(
      makeContext([{ id: "u1", teams: ["team_fin"] }]),
      buildRevision([]),
      noneUncovered,
    );

    expect(result.satisfied).toBe(false);
  });
});
