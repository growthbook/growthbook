import {
  ApprovalFlowConfiguration,
  ApprovalFlowConfigurations,
} from "shared/types/organization";
import {
  getApprovalFlowRules,
  getApprovalFlowSettings,
} from "../src/revisions/helpers";

const rule = (
  over: Partial<ApprovalFlowConfiguration> = {},
): ApprovalFlowConfiguration => ({
  projects: [],
  required: true,
  ...over,
});

const flows = (savedGroups: ApprovalFlowConfiguration[]) =>
  ({ savedGroups }) as ApprovalFlowConfigurations;

describe("approval flow project scoping", () => {
  it("returns nothing when the entity type has no rules", () => {
    expect(getApprovalFlowSettings(flows([]), "saved-group")).toBeUndefined();
    expect(
      getApprovalFlowSettings(flows([rule()]), "constant"),
    ).toBeUndefined();
  });

  // Rows written before the selector existed have no `projects` at all.
  it("treats a rule with no projects field as the all-projects layer", () => {
    const legacy = { required: true } as ApprovalFlowConfiguration;
    expect(
      getApprovalFlowSettings(flows([legacy]), "saved-group", ["prj_a"])
        ?.required,
    ).toBe(true);
  });

  it("inherits unset fields from the all-projects rule", () => {
    const rules = getApprovalFlowRules(
      flows([
        rule({ requiredApproverTeams: ["t_sec"], blockSelfApproval: true }),
        rule({ projects: ["prj_a"], requireMetadataReview: false }),
      ]),
      "saved-group",
      ["prj_a"],
    );

    expect(rules).toHaveLength(1);
    expect(rules[0].requiredApproverTeams).toEqual(["t_sec"]);
    expect(rules[0].blockSelfApproval).toBe(true);
    expect(rules[0].requireMetadataReview).toBe(false);
  });

  it("lets an override replace the inherited teams", () => {
    const rules = getApprovalFlowRules(
      flows([
        rule({ requiredApproverTeams: ["t_sec"] }),
        rule({ projects: ["prj_a"], requiredApproverTeams: ["t_pay"] }),
      ]),
      "saved-group",
      ["prj_a"],
    );

    expect(rules[0].requiredApproverTeams).toEqual(["t_pay"]);
  });

  // A saved group in several projects answers to each project's rule, and each
  // is its own requirement — so they must not collapse into one.
  it("returns one rule per governing project", () => {
    const rules = getApprovalFlowRules(
      flows([
        rule({ projects: ["prj_a"], requiredApproverTeams: ["t_sec"] }),
        rule({ projects: ["prj_b"], requiredApproverTeams: ["t_pay"] }),
      ]),
      "saved-group",
      ["prj_a", "prj_b"],
    );

    expect(rules.map((r) => r.requiredApproverTeams)).toEqual([
      ["t_sec"],
      ["t_pay"],
    ]);
  });

  it("dedupes projects that resolve to the same rule", () => {
    const rules = getApprovalFlowRules(
      flows([rule({ requiredApproverTeams: ["t_sec"] })]),
      "saved-group",
      ["prj_a", "prj_b"],
    );

    expect(rules).toHaveLength(1);
  });

  it("requires approval when any governing project requires it", () => {
    const settings = getApprovalFlowSettings(
      flows([
        rule({ projects: ["prj_a"], required: false }),
        rule({ projects: ["prj_b"], required: true }),
      ]),
      "saved-group",
      ["prj_a", "prj_b"],
    );

    expect(settings?.required).toBe(true);
  });

  it("takes the stricter answer on metadata review and self-approval", () => {
    const settings = getApprovalFlowSettings(
      flows([
        rule({
          projects: ["prj_a"],
          requireMetadataReview: false,
          blockSelfApproval: false,
        }),
        rule({
          projects: ["prj_b"],
          requireMetadataReview: true,
          blockSelfApproval: true,
        }),
      ]),
      "saved-group",
      ["prj_a", "prj_b"],
    );

    expect(settings?.requireMetadataReview).toBe(true);
    expect(settings?.blockSelfApproval).toBe(true);
  });

  // Autopublish loosens the flow, so one project allowing it is not enough.
  it("allows autopublish only when every governing project allows it", () => {
    const permissive = rule({
      projects: ["prj_a"],
      autopublishOnApproval: true,
    });
    const strict = rule({ projects: ["prj_b"], autopublishOnApproval: false });

    expect(
      getApprovalFlowSettings(flows([permissive, strict]), "saved-group", [
        "prj_a",
        "prj_b",
      ])?.autopublishOnApproval,
    ).toBe(false);
    expect(
      getApprovalFlowSettings(
        flows([
          permissive,
          rule({ projects: ["prj_b"], autopublishOnApproval: true }),
        ]),
        "saved-group",
        ["prj_a", "prj_b"],
      )?.autopublishOnApproval,
    ).toBe(true);
  });

  it("falls back to the all-projects rule for an entity in no project", () => {
    const settings = getApprovalFlowSettings(
      flows([
        rule({ requiredApproverTeams: ["t_sec"] }),
        rule({ projects: ["prj_a"], required: false }),
      ]),
      "saved-group",
      [],
    );

    expect(settings?.required).toBe(true);
  });
});
