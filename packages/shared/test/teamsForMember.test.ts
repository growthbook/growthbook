import { teamsForMember } from "shared/permissions";

const teams = [
  { id: "team_a", name: "Payments" },
  { id: "team_b", name: "Platform" },
  { id: "team_gone", name: "Deleted" },
];

const org = {
  members: [
    { id: "u_multi", teams: ["team_a", "team_b"] },
    { id: "u_one", teams: ["team_a"] },
    { id: "u_none", teams: [] },
    { id: "u_undef" },
    { id: "u_stale", teams: ["team_a", "team_missing"] },
  ],
};

describe("teamsForMember", () => {
  it("resolves every team the member belongs to, with names", () => {
    expect(teamsForMember("u_multi", org, teams)).toEqual([
      { id: "team_a", name: "Payments" },
      { id: "team_b", name: "Platform" },
    ]);
  });

  it("resolves a single team", () => {
    expect(teamsForMember("u_one", org, teams)).toEqual([
      { id: "team_a", name: "Payments" },
    ]);
  });

  it("returns nothing for a member on no teams", () => {
    expect(teamsForMember("u_none", org, teams)).toEqual([]);
    expect(teamsForMember("u_undef", org, teams)).toEqual([]);
  });

  // API-key reviewers and departed users are not members, so they are on no team.
  it("returns nothing for a non-member", () => {
    expect(teamsForMember("key_abc123", org, teams)).toEqual([]);
    expect(teamsForMember("u_gone", org, teams)).toEqual([]);
  });

  // A team id the member still carries after the team was deleted must not
  // surface as a nameless entry a hook would then fail to match.
  it("drops team ids that no longer resolve", () => {
    expect(teamsForMember("u_stale", org, teams)).toEqual([
      { id: "team_a", name: "Payments" },
    ]);
  });

  it("tolerates an org with no members", () => {
    expect(teamsForMember("u_one", {}, teams)).toEqual([]);
  });
});
