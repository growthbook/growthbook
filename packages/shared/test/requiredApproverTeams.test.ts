import { assessRequiredApproverTeams } from "shared/permissions";

const teams = [
  { id: "t_fin", name: "Finance" },
  { id: "t_pay", name: "Payments" },
  { id: "t_plat", name: "Platform" },
];

const org = {
  members: [
    { id: "u_fin", teams: ["t_fin"] },
    { id: "u_pay", teams: ["t_pay"] },
    { id: "u_both", teams: ["t_fin", "t_pay"] },
    { id: "u_none", teams: [] },
  ],
};

const assess = (
  rules: { requiredApproverTeams?: string[] }[],
  coveringApproverIds: string[],
) => assessRequiredApproverTeams({ rules, coveringApproverIds, org, teams });

describe("required approver teams", () => {
  it("is satisfied when a rule names no teams", () => {
    expect(assess([{}], []).satisfied).toBe(true);
    expect(assess([{ requiredApproverTeams: [] }], []).satisfied).toBe(true);
  });

  it("needs someone from the named team", () => {
    const rules = [{ requiredApproverTeams: ["t_fin"] }];

    expect(assess(rules, []).satisfied).toBe(false);
    expect(assess(rules, ["u_pay"]).satisfied).toBe(false);
    expect(assess(rules, ["u_fin"]).satisfied).toBe(true);
  });

  // OR within a rule: this is the decision that keeps the single-approval model.
  it("accepts any one of the teams a rule names", () => {
    const rules = [{ requiredApproverTeams: ["t_fin", "t_pay"] }];

    expect(assess(rules, ["u_pay"]).satisfied).toBe(true);
    expect(assess(rules, ["u_fin"]).satisfied).toBe(true);
    expect(assess(rules, ["u_none"]).satisfied).toBe(false);
  });

  // AND across rules: two governing projects each demanding their own team.
  it("requires every rule to be satisfied", () => {
    const rules = [
      { requiredApproverTeams: ["t_fin"] },
      { requiredApproverTeams: ["t_pay"] },
    ];

    expect(assess(rules, ["u_fin"]).satisfied).toBe(false);
    expect(assess(rules, ["u_fin", "u_pay"]).satisfied).toBe(true);
    // One person on both teams satisfies both rules.
    expect(assess(rules, ["u_both"]).satisfied).toBe(true);
  });

  it("names the teams that would satisfy an unmet rule", () => {
    const result = assess([{ requiredApproverTeams: ["t_fin", "t_pay"] }], []);

    expect(result.unmet).toEqual([
      [
        { id: "t_fin", name: "Finance" },
        { id: "t_pay", name: "Payments" },
      ],
    ]);
  });

  // A non-covering approval cannot satisfy a team requirement either, or widening
  // a draft past its approver would leave the team box ticked.
  it("only counts approvers passed as covering", () => {
    const rules = [{ requiredApproverTeams: ["t_fin"] }];

    expect(assess(rules, ["u_fin"]).satisfied).toBe(true);
    expect(assess(rules, []).satisfied).toBe(false);
  });

  // A rule naming only deleted teams can never be met and cannot be explained,
  // so it must not block publishing forever.
  it("ignores a rule whose teams no longer exist", () => {
    expect(assess([{ requiredApproverTeams: ["t_gone"] }], []).satisfied).toBe(
      true,
    );
  });

  it("still enforces the surviving teams of a partly-deleted rule", () => {
    const rules = [{ requiredApproverTeams: ["t_gone", "t_fin"] }];

    expect(assess(rules, []).satisfied).toBe(false);
    expect(assess(rules, []).unmet).toEqual([
      [{ id: "t_fin", name: "Finance" }],
    ]);
    expect(assess(rules, ["u_fin"]).satisfied).toBe(true);
  });
});
