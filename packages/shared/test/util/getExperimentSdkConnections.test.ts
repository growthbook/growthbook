import { LinkedFeatureInfo } from "shared/types/experiment";
import { getExperimentSdkConnections } from "../../src/util";

const conn = (id: string, projects: string[]) => ({ id, projects });
const linked = (feature: {
  project?: string;
  targetingProjects?: string[];
  targetingAllProjects?: boolean;
}) => ({ feature }) as unknown as LinkedFeatureInfo;

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
      ids(
        getExperimentSdkConnections(connections, "prj_a", [
          linked({ project: "prj_b" }),
        ]),
      ),
    ).toEqual(["unscoped", "a", "b"]);
  });

  it("adds connections serving a linked feature's secondary targeting projects", () => {
    expect(
      ids(
        getExperimentSdkConnections(connections, "prj_a", [
          linked({ project: "prj_b", targetingProjects: ["prj_c"] }),
        ]),
      ),
    ).toEqual(["unscoped", "a", "b", "c"]);
  });

  it("keeps every connection when a linked feature targets all projects", () => {
    expect(
      ids(
        getExperimentSdkConnections(connections, "prj_a", [
          linked({ project: "prj_b", targetingAllProjects: true }),
        ]),
      ),
    ).toEqual(["unscoped", "a", "b", "c"]);
  });

  it("only keeps unscoped connections for an experiment and features with no project", () => {
    expect(
      ids(getExperimentSdkConnections(connections, undefined, [linked({})])),
    ).toEqual(["unscoped"]);
  });
});
