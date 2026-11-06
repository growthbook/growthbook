import { nonContributingApproverIds } from "../../src/permissions/resolveUserPermissions";

const teams = [
  { id: "t-finance", name: "Finance" },
  { id: "t-eng", name: "Engineering" },
];
const org = {
  members: [
    { id: "u-fin", teams: ["t-finance"] },
    { id: "u-eng", teams: ["t-eng"] },
    { id: "u-both", teams: ["t-finance", "t-eng"] },
    { id: "u-none" },
  ],
};

describe("nonContributingApproverIds", () => {
  it.each([
    { requiredTeamsSatisfied: true, enforcedTeamIds: [["t-finance"]] },
    { requiredTeamsSatisfied: false, enforcedTeamIds: [] },
  ])("returns nobody for %j", ({ requiredTeamsSatisfied, enforcedTeamIds }) => {
    expect(
      nonContributingApproverIds({
        approvedIds: ["u-eng", "u-none"],
        enforcedTeamIds,
        requiredTeamsSatisfied,
        org,
        teams,
      }),
    ).toEqual([]);
  });

  it("names approvers on none of the enforced teams", () => {
    expect(
      nonContributingApproverIds({
        approvedIds: ["u-fin", "u-eng", "u-both", "u-none", "u-ghost"],
        enforcedTeamIds: [["t-finance"]],
        requiredTeamsSatisfied: false,
        org,
        teams,
      }),
    ).toEqual(["u-eng", "u-none", "u-ghost"]);
  });

  it("counts an approver who covers any one of several rules", () => {
    expect(
      nonContributingApproverIds({
        approvedIds: ["u-fin", "u-eng", "u-none"],
        enforcedTeamIds: [["t-finance"], ["t-eng"]],
        requiredTeamsSatisfied: false,
        org,
        teams,
      }),
    ).toEqual(["u-none"]);
  });
});
