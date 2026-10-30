import type { ExposureQuery } from "shared/types/datasource";
import {
  getClusterChangeAfterLaunch,
  getLockedClusterError,
  isClusterConfigLocked,
} from "@/components/Experiment/AssignmentQueryFields";

const query = (name: string, userIdTypes: string[]) =>
  ({
    id: name,
    name,
    userIdType: userIdTypes[0],
    userIdTypes,
  }) as ExposureQuery;

const regionQuery = query("Region exposures", ["region_id", "user_id"]);
const clusterExperiment = {
  isClusterExperiment: true,
  clusterSubUnitIdentifier: "user_id",
};

const lockError = (
  overrides: Partial<Parameters<typeof getLockedClusterError>[0]> = {},
) =>
  getLockedClusterError({
    experiment: clusterExperiment,
    locked: true,
    datasourceSelected: true,
    supportsClusterExperiments: true,
    exposureQuery: regionQuery,
    identifierType: "region_id",
    savedClusterIdentifier: "region_id",
    ...overrides,
  });

describe("isClusterConfigLocked", () => {
  const withLinkedFeature = { linkedFeatures: ["feature"] };

  it("locks once a started experiment's traffic comes from linked changes", () => {
    expect(
      isClusterConfigLocked({ status: "running", ...withLinkedFeature }),
    ).toBe(true);
  });

  it("stays unlocked for drafts and experiments without linked changes", () => {
    expect(
      isClusterConfigLocked({ status: "draft", ...withLinkedFeature }),
    ).toBe(false);
    expect(
      isClusterConfigLocked({ status: "running", linkedFeatures: [] }),
    ).toBe(false);
  });
});

describe("getLockedClusterError", () => {
  it("allows any choice when the experiment isn't locked or isn't clustered", () => {
    expect(lockError({ locked: false, identifierType: "user_id" })).toBeNull();
    expect(
      lockError({
        experiment: { isClusterExperiment: false },
        identifierType: "user_id",
      }),
    ).toBeNull();
  });

  it("allows a choice that keeps the locked cluster and subunit", () => {
    expect(lockError()).toBeNull();
  });

  it("puts a missing or unsupported Data Source under the Data Source", () => {
    expect(lockError({ datasourceSelected: false })?.field).toBe("datasource");
    expect(lockError({ supportsClusterExperiments: false })).toMatchObject({
      field: "datasource",
      message: expect.stringContaining("has no assignment queries"),
    });
  });

  it("rejects an identifier type other than the saved cluster", () => {
    expect(lockError({ identifierType: "user_id" })?.field).toBe("identifier");
  });

  it("rejects a query that doesn't include the saved subunit", () => {
    expect(
      lockError({
        exposureQuery: query("Device exposures", ["region_id", "device_id"]),
      }),
    ).toMatchObject({
      field: "subunit",
      message: expect.stringContaining(
        "Device exposures doesn't include user_id",
      ),
    });
  });
});

describe("getClusterChangeAfterLaunch", () => {
  const running = { status: "running" as const, ...clusterExperiment };
  const next = {
    isClusterExperiment: true,
    clusterSubUnitIdentifier: "user_id",
  };

  it("says nothing for drafts or unchanged settings", () => {
    expect(
      getClusterChangeAfterLaunch(
        { ...running, status: "draft" },
        { ...next, isClusterExperiment: false },
      ),
    ).toBeNull();
    expect(getClusterChangeAfterLaunch(running, next)).toBeNull();
  });

  it("names whether cluster mode or the subunit changed", () => {
    expect(
      getClusterChangeAfterLaunch(running, {
        ...next,
        isClusterExperiment: false,
      }),
    ).toBe("mode");
    expect(
      getClusterChangeAfterLaunch(running, {
        ...next,
        clusterSubUnitIdentifier: "device_id",
      }),
    ).toBe("subunit");
  });
});
