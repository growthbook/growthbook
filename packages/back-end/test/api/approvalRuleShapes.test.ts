import { mergeApprovalFlows } from "back-end/src/api/settings/approvalRuleShapes";

const savedGroups = [{ required: true, projects: [] }];
const sdkConnections = [
  { required: true, projects: [], environments: ["production"] },
];

describe("mergeApprovalFlows", () => {
  it("replaces SDK connection rules and keeps the stored Saved Group rules", () => {
    expect(
      mergeApprovalFlows(
        { savedGroups, sdkConnections: [] },
        { sdkConnections },
      ),
    ).toEqual({ savedGroups, sdkConnections });
  });

  it("replaces Saved Group rules and keeps the stored SDK connection rules", () => {
    expect(
      mergeApprovalFlows({ savedGroups: [], sdkConnections }, { savedGroups }),
    ).toEqual({ savedGroups, sdkConnections });
  });

  it("replaces both families when both are supplied, including with empty lists", () => {
    expect(
      mergeApprovalFlows(
        { savedGroups, sdkConnections },
        { savedGroups: [], sdkConnections: [] },
      ),
    ).toEqual({ savedGroups: [], sdkConnections: [] });
  });

  it("starts an org with nothing stored from empty Saved Group rules", () => {
    expect(mergeApprovalFlows(undefined, { sdkConnections })).toEqual({
      savedGroups: [],
      sdkConnections,
    });
  });

  it("does not invent SDK connection rules for an org that has none", () => {
    expect(mergeApprovalFlows(undefined, { savedGroups })).toEqual({
      savedGroups,
    });
    expect(
      Object.keys(mergeApprovalFlows({ savedGroups: [] }, { savedGroups })),
    ).toEqual(["savedGroups"]);
  });
});
