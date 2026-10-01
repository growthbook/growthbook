import { LinkedFeatureInfo } from "shared/types/experiment";
import { getExperimentSdkConnections } from "../../src/util";

const conn = (id: string, projects: string[]) => ({ id, projects });
const linked = (project?: string) =>
  ({ feature: { project } }) as unknown as LinkedFeatureInfo;

const connections = [
  conn("unscoped", []),
  conn("a", ["prj_a"]),
  conn("b", ["prj_b"]),
  conn("c", ["prj_c"]),
];

const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe("getExperimentSdkConnections", () => {
  it("keeps unscoped connections and ones in the experiment's project", () => {
    expect(ids(getExperimentSdkConnections(connections, "prj_a", []))).toEqual([
      "unscoped",
      "a",
    ]);
  });

  it("adds connections serving a linked feature's project", () => {
    expect(
      ids(getExperimentSdkConnections(connections, "prj_a", [linked("prj_b")])),
    ).toEqual(["unscoped", "a", "b"]);
  });

  it("only keeps unscoped connections for an experiment and features with no project", () => {
    expect(
      ids(getExperimentSdkConnections(connections, undefined, [linked()])),
    ).toEqual(["unscoped"]);
  });
});
