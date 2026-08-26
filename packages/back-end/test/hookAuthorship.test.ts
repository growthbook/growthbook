import { teamsForMember } from "shared/permissions";
import { coauthorIds } from "shared/enterprise";

const teams = [
  { id: "t_pay", name: "Payments" },
  { id: "t_plat", name: "Platform" },
];
const org = {
  members: [
    { id: "u_author", teams: ["t_pay"] },
    { id: "u_editor", teams: ["t_plat"] },
    { id: "u_loner", teams: [] },
  ],
};

describe("draft authorship exposed to hooks", () => {
  it("excludes the author from coauthors", () => {
    expect(coauthorIds("u_author", ["u_author", "u_editor"])).toEqual([
      "u_editor",
    ]);
  });

  it("keeps every other editor", () => {
    expect(coauthorIds("u_author", ["u_editor", "u_loner"])).toEqual([
      "u_editor",
      "u_loner",
    ]);
  });

  it("handles an unattributed draft", () => {
    expect(coauthorIds(undefined, ["u_editor"])).toEqual(["u_editor"]);
    expect(coauthorIds("u_author", undefined)).toEqual([]);
  });

  it("drops empty contributor ids", () => {
    expect(coauthorIds("u_author", ["", "u_editor"])).toEqual(["u_editor"]);
  });

  it("resolves each editor's teams the same way reviewers are resolved", () => {
    expect(teamsForMember("u_author", org, teams)).toEqual([
      { id: "t_pay", name: "Payments" },
    ]);
    expect(teamsForMember("u_loner", org, teams)).toEqual([]);
    // An API key contributor is not a member, so it belongs to no team.
    expect(teamsForMember("key_abc", org, teams)).toEqual([]);
  });
});
