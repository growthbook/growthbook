import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { postExperimentChangesBody } from "shared/validators";
import { buildMakeChangesBody } from "@/components/Experiment/makeChangesRequest";

const experiment = {
  variations: [
    { id: "v0", key: "0", name: "Control", screenshots: [] },
    { id: "v1", key: "1", name: "Treatment", screenshots: [] },
  ],
  phases: [
    {
      variations: [
        { id: "v0", status: "active" },
        { id: "v1", status: "active" },
      ],
    },
  ],
} as unknown as ExperimentInterfaceStringDates;

const defaults: ExperimentTargetingData = {
  condition: '{"country":"US"}',
  savedGroups: [{ match: "all", ids: ["grp_1"] }],
  prerequisites: [],
  coverage: 1,
  namespace: { enabled: false, name: "", format: "multiRange", ranges: [] },
  variationWeights: [0.5, 0.5],
  variations: [
    { id: "v0", status: "active" },
    { id: "v1", status: "active" },
  ],
  hashAttribute: "id",
  fallbackAttribute: "",
  hashVersion: 2,
  disableStickyBucketing: false,
  attributeScopeAllProjects: false,
  seed: "seed",
  trackingKey: "key",
};

const build = (
  changeType: Parameters<typeof buildMakeChangesBody>[0]["changeType"],
  values: Partial<ExperimentTargetingData>,
) => {
  const body = buildMakeChangesBody({
    experiment,
    changeType,
    values: { ...defaults, ...values },
    defaults,
  });
  // Every body the wizard sends must pass the endpoint's strict schema.
  expect(postExperimentChangesBody.safeParse(body).success).toBe(true);
  return body;
};

describe("buildMakeChangesBody", () => {
  it("sends only the field of a single-field change", () => {
    expect(build("coverage", { coverage: 0.5 })).toEqual({
      changeType: "coverage",
      coverage: 0.5,
    });
    expect(build("weights", { variationWeights: [0.7, 0.3] })).toEqual({
      changeType: "weights",
      trafficSplit: [
        { variationId: "v0", weight: 0.7 },
        { variationId: "v1", weight: 0.3 },
      ],
    });
    expect(build("new-phase", {})).toEqual({ changeType: "new-phase" });
  });

  it("sends only the targeting fields that changed, clearing with null", () => {
    expect(build("targeting", { condition: "" })).toEqual({
      changeType: "targeting",
      targetingCondition: null,
    });
  });

  it("sends a namespace as merged ranges, or null to leave it", () => {
    expect(
      build("namespace", {
        namespace: {
          enabled: true,
          name: "checkout",
          format: "multiRange",
          ranges: [
            [0, 0.3],
            [0.3, 0.5],
          ],
        },
      }),
    ).toEqual({
      changeType: "namespace",
      namespace: { namespaceId: "checkout", ranges: [[0, 0.5]] },
    });
    expect(build("namespace", {})).toEqual({
      changeType: "namespace",
      namespace: null,
    });
  });

  it("combines only the changed fields under advanced", () => {
    expect(
      build("advanced", {
        coverage: 0.4,
        savedGroups: [],
      }),
    ).toEqual({ changeType: "advanced", coverage: 0.4, savedGroups: [] });
  });
});
