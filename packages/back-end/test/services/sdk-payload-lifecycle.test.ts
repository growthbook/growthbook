/**
 * Comprehensive SDK payload lifecycle test suite.
 * Standalone: covers cache layer, params resolution, refresh flow, queueing,
 * and shared-state immutability without relying on other test files.
 *
 * Dimensions: isSDKConnectionAffectedByPayloadKey, getFeatureDefinitionsWithCache
 * (hit/miss/storage none), getPayloadParamsFromApiKey (sdk vs legacy),
 * refreshSDKPayloadCache (bulk/targeted, mocks, no mutation), queueSDKPayloadRefresh.
 */

import cloneDeep from "lodash/cloneDeep";
import { FeatureInterface } from "shared/types/feature";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import {
  buildSDKPayloadForConnection,
  isSDKConnectionAffectedByPayloadKey,
  queueSDKPayloadRefresh,
  refreshSDKPayloadCache,
  type SDKPayloadRawData,
  type ConnectionPayloadOptions,
} from "back-end/src/services/features";
import * as FeatureModel from "back-end/src/models/FeatureModel";
import * as ExperimentModel from "back-end/src/models/ExperimentModel";

jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionByKey: jest.fn(),
  findSDKConnectionsByOrganization: jest.fn(),
  markSDKConnectionUsed: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("back-end/src/models/OrganizationModel", () => ({}));
jest.mock("back-end/src/models/ApiKeyModel", () => ({}));
jest.mock("back-end/src/util/api-key.util", () => ({
  ...jest.requireActual("back-end/src/util/api-key.util"),
  dangerousLookupOrganizationByApiKey: jest.fn(),
}));
jest.mock("back-end/src/models/SdkConnectionCacheModel", () => ({
  ...jest.requireActual("back-end/src/models/SdkConnectionCacheModel"),
  getSDKPayloadCacheLocation: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeatures: jest.fn().mockResolvedValue([]),
  getAllFeaturesWithoutEditorFields: jest.fn().mockResolvedValue([]),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllPayloadExperiments: jest.fn().mockResolvedValue(new Map()),
  getAllVisualExperiments: jest.fn().mockResolvedValue([]),
  getAllURLRedirectExperiments: jest.fn().mockResolvedValue([]),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn((org: { id: string }) => ({
    org,
    models: (global as unknown as { __mockContextModels: unknown })
      .__mockContextModels,
    getAllProjectIds: jest.fn(
      async () =>
        (global as unknown as { __mockAllProjectIds?: string[] })
          .__mockAllProjectIds ?? [],
    ),
    userId: "u",
    email: "e@e.com",
    userName: "U",
    initModels: jest.fn(),
  })),
  getEnvironmentIdsFromOrg: jest.fn(
    (org: { settings?: { environments?: { id: string }[] } }) =>
      org.settings?.environments?.map((e) => e.id) ?? ["production"],
  ),
}));
jest.mock("back-end/src/jobs/updateAllJobs", () => ({
  triggerWebhookJobs: jest.fn().mockResolvedValue(undefined),
}));

const getSDKPayloadCacheLocationMock = jest.requireMock(
  "back-end/src/models/SdkConnectionCacheModel",
).getSDKPayloadCacheLocation as jest.Mock;
const findSDKConnectionsByOrganization = jest.requireMock(
  "back-end/src/models/SdkConnectionModel",
).findSDKConnectionsByOrganization as jest.Mock;
const triggerWebhookJobs = jest.requireMock("back-end/src/jobs/updateAllJobs")
  .triggerWebhookJobs as jest.Mock;
const getContextForAgendaJobByOrgObject = jest.requireMock(
  "back-end/src/services/organizations",
).getContextForAgendaJobByOrgObject as jest.Mock;
// The background context refreshSDKPayloadCache created for its last call.
const agendaContext = () =>
  getContextForAgendaJobByOrgObject.mock.results.slice(-1)[0].value as {
    getAllProjectIds: jest.Mock;
  };

function minimalContext(overrides?: Partial<ApiReqContext>): ApiReqContext {
  return {
    org: {
      id: "org-1",
      name: "Test",
      url: "",
      dateCreated: new Date(),
      ownerEmail: "",
      members: [],
      invites: [],
      settings: { environments: [{ id: "production", projects: [] }] },
    },
    models: {} as ApiReqContext["models"],
    getAllProjectIds: async () => [],
    userId: "u1",
    email: "e@e.com",
    userName: "User",
    initModels: () => {},
    ...overrides,
  } as ApiReqContext;
}

function minimalRawData(
  overrides?: Partial<SDKPayloadRawData>,
): SDKPayloadRawData {
  return {
    features: [],
    experimentMap: new Map(),
    groupMap: new Map(),
    safeRolloutMap: new Map(),
    savedGroups: [],
    holdoutsMap: new Map(),
    ...overrides,
  };
}

describe("SDK payload lifecycle (comprehensive)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (
      global as unknown as { __mockContextModels: unknown }
    ).__mockContextModels = undefined;
    (
      global as unknown as { __mockAllProjectIds?: string[] }
    ).__mockAllProjectIds = undefined;
  });

  describe("isSDKConnectionAffectedByPayloadKey", () => {
    const conn = (
      overrides: Partial<SDKConnectionInterface> = {},
    ): SDKConnectionInterface =>
      ({
        key: "sdk-key-1",
        organization: "org-1",
        name: "Conn",
        environment: "production",
        projects: ["p1", "p2"],
        ...overrides,
      }) as SDKConnectionInterface;

    it("returns false when environment does not match", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(
          conn({ environment: "production" }),
          {
            environment: "dev",
            project: "p1",
          },
        ),
      ).toBe(false);
    });

    it("returns true when environment matches and connection has no projects (global)", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(conn({ projects: [] }), {
          environment: "production",
          project: "p1",
        }),
      ).toBe(true);
    });

    it("returns true when environment matches and connection projects include payload project", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(conn(), {
          environment: "production",
          project: "p1",
        }),
      ).toBe(true);
    });

    it("returns false when environment matches but connection projects do not include payload project", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(conn(), {
          environment: "production",
          project: "p3",
        }),
      ).toBe(false);
    });

    it("treatEmptyProjectAsGlobal: payload with no project affects all connections in env", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(
          conn({ environment: "production", projects: ["p1"] }),
          { environment: "production", project: "" },
          true,
        ),
      ).toBe(true);
    });
  });

  describe("refreshSDKPayloadCache", () => {
    it("bulk path: deleteAllLegacyCacheEntries, load rawData once, findSDKConnectionsByOrganization, build+upsert per connection, triggerWebhookJobs", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
      const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
      const upsert = jest.fn().mockResolvedValue(undefined);
      const conn1 = {
        key: "sdk-1",
        organization: "org-1",
        environment: "production",
        projects: [],
      } as SDKConnectionInterface;
      const conn2 = {
        key: "sdk-2",
        organization: "org-1",
        environment: "production",
        projects: [],
      } as SDKConnectionInterface;
      findSDKConnectionsByOrganization.mockResolvedValue([conn1, conn2]);
      (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(
        new Map(),
      );
      (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue(
        [],
      );
      (
        ExperimentModel.getAllURLRedirectExperiments as jest.Mock
      ).mockResolvedValue([]);

      const mockModels = {
        sdkConnectionCache: {
          deleteAllLegacyCacheEntries: deleteAllLegacy,
          upsert,
        },
        safeRollout: {
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        constants: { getAll: jest.fn().mockResolvedValue([]) },
        configs: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: {
          getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()),
        },
        rampSchedules: {
          getPayloadRampMonitoredRuleMap: jest
            .fn()
            .mockResolvedValue(new Map()),
        },
      };
      (
        global as unknown as { __mockContextModels: unknown }
      ).__mockContextModels = mockModels;

      await refreshSDKPayloadCache({
        context: minimalContext({
          models: mockModels as ReqContext["models"],
        }) as ReqContext,
        payloadKeys: [{ environment: "production", project: "p1" }],
        sdkConnections: [],
      });

      expect(deleteAllLegacy).toHaveBeenCalled();
      expect(FeatureModel.getAllFeatures).toHaveBeenCalled();
      expect(findSDKConnectionsByOrganization).toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert).toHaveBeenCalledWith(
        "sdk-1",
        expect.any(String),
        undefined,
      );
      expect(upsert).toHaveBeenCalledWith(
        "sdk-2",
        expect.any(String),
        undefined,
      );
      expect(triggerWebhookJobs).toHaveBeenCalled();
    });

    // Models touched only when payloads are actually built and stored. Kept
    // separate so tests can assert the early paths never reach them.
    function payloadBuildModels() {
      return {
        safeRollout: {
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        constants: { getAll: jest.fn().mockResolvedValue([]) },
        configs: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: {
          getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()),
        },
        rampSchedules: {
          getPayloadRampMonitoredRuleMap: jest
            .fn()
            .mockResolvedValue(new Map()),
        },
        projects: { getAll: jest.fn().mockResolvedValue([]) },
      };
    }
    function expectNoPayloadBuildLoads(
      models: ReturnType<typeof payloadBuildModels>,
    ) {
      expect(models.savedGroups.getAll).not.toHaveBeenCalled();
      expect(
        models.safeRollout.getAllPayloadSafeRollouts,
      ).not.toHaveBeenCalled();
      expect(models.constants.getAll).not.toHaveBeenCalled();
      expect(
        models.rampSchedules.getPayloadRampMonitoredRuleMap,
      ).not.toHaveBeenCalled();
      expect(models.holdout.getAllPayloadHoldouts).not.toHaveBeenCalled();
      expect(models.projects.getAll).not.toHaveBeenCalled();
      expect(ExperimentModel.getAllVisualExperiments).not.toHaveBeenCalled();
      expect(
        ExperimentModel.getAllURLRedirectExperiments,
      ).not.toHaveBeenCalled();
    }
    const twoEnvOrg = {
      ...minimalContext().org,
      settings: {
        environments: [
          { id: "production", projects: [] },
          { id: "dev", projects: [] },
        ],
      },
    };
    const sdkConn = (
      key: string,
      projects: string[],
      environment = "production",
    ) =>
      ({
        key,
        organization: "org-1",
        environment,
        projects,
      }) as SDKConnectionInterface;

    it.each(["none", "mongo"] as const)(
      "storage %s: triggerWebhookJobs receives exactly the affected connections; with no cache only the loads that decide that set run",
      async (storage) => {
        getSDKPayloadCacheLocationMock.mockReturnValue(storage);
        const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
        const upsert = jest.fn().mockResolvedValue(undefined);
        const affectedGlobal = sdkConn("sdk-global-prod", []);
        const affectedProject = sdkConn("sdk-p1-prod", ["p1"]);
        const otherProject = sdkConn("sdk-p2-prod", ["p2"]);
        const otherEnv = sdkConn("sdk-global-dev", [], "dev");
        findSDKConnectionsByOrganization.mockResolvedValue([
          affectedGlobal,
          otherProject,
          affectedProject,
          otherEnv,
        ]);

        const mockModels = {
          sdkConnectionCache: {
            deleteAllLegacyCacheEntries: deleteAllLegacy,
            upsert,
          },
          ...payloadBuildModels(),
        };
        (
          global as unknown as { __mockContextModels: unknown }
        ).__mockContextModels = mockModels;

        const payloadKeys = [{ environment: "production", project: "p1" }];
        await refreshSDKPayloadCache({
          context: minimalContext({
            org: twoEnvOrg,
            models: mockModels as unknown as ReqContext["models"],
          }) as ReqContext,
          payloadKeys,
          sdkConnections: [],
        });

        // Same side effects and notification fan-out regardless of cache location
        expect(deleteAllLegacy).toHaveBeenCalledTimes(1);
        expect(ExperimentModel.getAllPayloadExperiments).toHaveBeenCalledTimes(
          1,
        );
        expect(findSDKConnectionsByOrganization).toHaveBeenCalledTimes(1);
        expect(triggerWebhookJobs).toHaveBeenCalledTimes(1);
        expect(triggerWebhookJobs).toHaveBeenCalledWith(
          expect.objectContaining({
            org: expect.objectContaining({ id: "org-1" }),
          }),
          payloadKeys,
          [affectedGlobal, affectedProject],
          true,
        );

        if (storage === "none") {
          // Nothing persists a pre-built payload: only the lean feature load and
          // the experiments (both needed to widen the keys) are read; nothing is
          // built or upserted.
          expect(
            FeatureModel.getAllFeaturesWithoutEditorFields,
          ).toHaveBeenCalledTimes(1);
          expect(FeatureModel.getAllFeatures).not.toHaveBeenCalled();
          expectNoPayloadBuildLoads(mockModels);
          expect(upsert).not.toHaveBeenCalled();
        } else {
          expect(FeatureModel.getAllFeatures).toHaveBeenCalledTimes(1);
          expect(
            FeatureModel.getAllFeaturesWithoutEditorFields,
          ).not.toHaveBeenCalled();
          expect(mockModels.savedGroups.getAll).toHaveBeenCalledTimes(1);
          // Holdouts only for environments that have an affected connection
          expect(
            mockModels.holdout.getAllPayloadHoldouts,
          ).toHaveBeenCalledTimes(1);
          expect(mockModels.holdout.getAllPayloadHoldouts).toHaveBeenCalledWith(
            "production",
          );
          expect(upsert).toHaveBeenCalledTimes(2);
          expect(upsert).toHaveBeenCalledWith(
            "sdk-global-prod",
            expect.any(String),
            undefined,
          );
          expect(upsert).toHaveBeenCalledWith(
            "sdk-p1-prod",
            expect.any(String),
            undefined,
          );
          // Consumers fetch the payload from the cache, so every upsert must
          // have happened before they are notified.
          const notifiedAt = triggerWebhookJobs.mock.invocationCallOrder[0];
          upsert.mock.invocationCallOrder.forEach((order) =>
            expect(order).toBeLessThan(notifiedAt),
          );
        }
      },
    );

    it.each(["none", "mongo"] as const)(
      "storage %s: no matching connections returns after the feature/experiment loads and before everything else, without notifying",
      async (storage) => {
        getSDKPayloadCacheLocationMock.mockReturnValue(storage);
        const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
        const upsert = jest.fn().mockResolvedValue(undefined);
        findSDKConnectionsByOrganization.mockResolvedValue([
          sdkConn("sdk-dev", [], "dev"),
        ]);
        const mockModels = {
          sdkConnectionCache: {
            deleteAllLegacyCacheEntries: deleteAllLegacy,
            upsert,
          },
          ...payloadBuildModels(),
        };
        (
          global as unknown as { __mockContextModels: unknown }
        ).__mockContextModels = mockModels;

        await refreshSDKPayloadCache({
          context: minimalContext({
            org: twoEnvOrg,
            models: mockModels as unknown as ReqContext["models"],
          }) as ReqContext,
          payloadKeys: [{ environment: "production", project: "p1" }],
          sdkConnections: [],
        });

        expect(deleteAllLegacy).toHaveBeenCalledTimes(1);
        expect(ExperimentModel.getAllPayloadExperiments).toHaveBeenCalledTimes(
          1,
        );
        if (storage === "none") {
          expect(
            FeatureModel.getAllFeaturesWithoutEditorFields,
          ).toHaveBeenCalledTimes(1);
        } else {
          expect(FeatureModel.getAllFeatures).toHaveBeenCalledTimes(1);
        }
        expectNoPayloadBuildLoads(mockModels);
        expect(upsert).not.toHaveBeenCalled();
        expect(triggerWebhookJobs).not.toHaveBeenCalled();
      },
    );

    // Cross-project prerequisites (#6858): a change to a project-A feature that
    // a project-B feature lists as a prerequisite must also reach connections
    // scoped to project B, on both cache paths.
    describe.each(["none", "mongo"] as const)(
      "storage %s: cross-project prerequisite widening happens before connections are matched",
      (storage) => {
        const parent = {
          id: "parent-flag",
          organization: "org-1",
          project: "prj-a",
          valueType: "boolean",
          defaultValue: "true",
          environmentSettings: { production: { enabled: true } },
          rules: [],
          prerequisites: [],
        } as unknown as FeatureInterface;
        const dependent = {
          id: "dependent-flag",
          organization: "org-1",
          project: "prj-b",
          valueType: "boolean",
          defaultValue: "false",
          environmentSettings: { production: { enabled: true } },
          rules: [],
          prerequisites: [{ id: "parent-flag", condition: "{}" }],
        } as unknown as FeatureInterface;
        const connA = sdkConn("sdk-a", ["prj-a"]);
        const connB = sdkConn("sdk-b", ["prj-b"]);
        const connC = sdkConn("sdk-c", ["prj-c"]);
        const changedParentKeys = [
          { environment: "production", project: "prj-a" },
        ];

        let upsert: jest.Mock;
        let mockModels: ReturnType<typeof payloadBuildModels> & {
          sdkConnectionCache: {
            deleteAllLegacyCacheEntries: jest.Mock;
            upsert: jest.Mock;
          };
        };
        beforeEach(() => {
          // These module mocks keep their resolved value across tests
          // (clearAllMocks only clears calls), so start each case from empty.
          (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
          (
            FeatureModel.getAllFeaturesWithoutEditorFields as jest.Mock
          ).mockResolvedValue([]);
          (
            ExperimentModel.getAllPayloadExperiments as jest.Mock
          ).mockResolvedValue(new Map());
          getSDKPayloadCacheLocationMock.mockReturnValue(storage);
          upsert = jest.fn().mockResolvedValue(undefined);
          mockModels = {
            sdkConnectionCache: {
              deleteAllLegacyCacheEntries: jest
                .fn()
                .mockResolvedValue(undefined),
              upsert,
            },
            ...payloadBuildModels(),
          };
          (
            global as unknown as { __mockContextModels: unknown }
          ).__mockContextModels = mockModels;
          findSDKConnectionsByOrganization.mockResolvedValue([
            connA,
            connB,
            connC,
          ]);
        });
        function useFeatures(features: FeatureInterface[]) {
          (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue(
            features,
          );
          (
            FeatureModel.getAllFeaturesWithoutEditorFields as jest.Mock
          ).mockResolvedValue(features);
        }
        async function refresh(
          extra: Partial<Parameters<typeof refreshSDKPayloadCache>[0]> = {},
        ) {
          await refreshSDKPayloadCache({
            context: minimalContext({
              models: mockModels as unknown as ReqContext["models"],
            }) as ReqContext,
            payloadKeys: changedParentKeys,
            sdkConnections: [],
            ...extra,
          });
        }
        function expectNotified(
          connections: SDKConnectionInterface[],
          projects: string[],
        ) {
          expect(triggerWebhookJobs).toHaveBeenCalledTimes(1);
          const [, keys, notified] = triggerWebhookJobs.mock.calls[0];
          expect(notified).toEqual(connections);
          expect(
            (keys as { environment: string; project: string }[])
              .map((k) => k.project)
              .sort(),
          ).toEqual([...projects].sort());
          if (storage === "none") {
            expect(upsert).not.toHaveBeenCalled();
          } else {
            expect(upsert.mock.calls.map((c) => c[0]).sort()).toEqual(
              connections.map((c) => c.key).sort(),
            );
            // Every cache write lands before anyone is notified.
            const notifiedAt = triggerWebhookJobs.mock.invocationCallOrder[0];
            upsert.mock.invocationCallOrder.forEach((order) =>
              expect(order).toBeLessThan(notifiedAt),
            );
          }
        }

        it("top-level prerequisite in another project: the dependent's connection is notified too", async () => {
          useFeatures([parent, dependent]);
          await refresh();
          expectNotified([connA, connB], ["prj-a", "prj-b"]);
          // No all-projects dependent: the project list is not consulted.
          expect(agendaContext().getAllProjectIds).not.toHaveBeenCalled();
        });

        it("prerequisite on the phase of an experiment referenced by an experiment-ref rule", async () => {
          const viaExperiment = {
            ...dependent,
            prerequisites: [],
            rules: [
              {
                type: "experiment-ref",
                id: "fr_1",
                enabled: true,
                experimentId: "exp-x",
                variations: [],
              },
            ],
          } as unknown as FeatureInterface;
          (
            ExperimentModel.getAllPayloadExperiments as jest.Mock
          ).mockResolvedValue(
            new Map([
              [
                "exp-x",
                {
                  id: "exp-x",
                  phases: [
                    { prerequisites: [{ id: "parent-flag", condition: "{}" }] },
                  ],
                },
              ],
            ]),
          );
          useFeatures([parent, viaExperiment]);
          await refresh();
          expectNotified([connA, connB], ["prj-a", "prj-b"]);
        });

        it("all-projects dependent: every project's connection is notified and the project list is consulted", async () => {
          const everywhere = {
            ...dependent,
            project: "",
            targetingAllProjects: true,
          } as unknown as FeatureInterface;
          (
            global as unknown as { __mockAllProjectIds?: string[] }
          ).__mockAllProjectIds = ["prj-a", "prj-b", "prj-c"];
          useFeatures([parent, everywhere]);
          await refresh();
          expectNotified([connA, connB, connC], ["prj-a", "prj-b", "prj-c"]);
          expect(agendaContext().getAllProjectIds).toHaveBeenCalledTimes(1);
        });

        it("skipRefreshForProject still wins over a project the widening reintroduces", async () => {
          useFeatures([parent, dependent]);
          await refresh({ skipRefreshForProject: "prj-b" });
          expectNotified([connA], ["prj-a"]);
        });
      },
    );

    it("targeted path: uses sdkConnectionsToUpdate, does not call findSDKConnectionsByOrganization", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
      const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
      const upsert = jest.fn().mockResolvedValue(undefined);
      const conn = {
        key: "sdk-single",
        organization: "org-1",
        environment: "production",
        projects: [],
      } as SDKConnectionInterface;

      (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(
        new Map(),
      );
      (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue(
        [],
      );
      (
        ExperimentModel.getAllURLRedirectExperiments as jest.Mock
      ).mockResolvedValue([]);

      const mockModels = {
        sdkConnectionCache: {
          deleteAllLegacyCacheEntries: deleteAllLegacy,
          upsert,
        },
        safeRollout: {
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        constants: { getAll: jest.fn().mockResolvedValue([]) },
        configs: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: {
          getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()),
        },
        rampSchedules: {
          getPayloadRampMonitoredRuleMap: jest
            .fn()
            .mockResolvedValue(new Map()),
        },
      };
      (
        global as unknown as { __mockContextModels: unknown }
      ).__mockContextModels = mockModels;

      await refreshSDKPayloadCache({
        context: minimalContext({
          models: mockModels as ReqContext["models"],
        }) as ReqContext,
        payloadKeys: [],
        sdkConnections: [conn],
      });

      expect(findSDKConnectionsByOrganization).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith(
        "sdk-single",
        expect.any(String),
        undefined,
      );
    });

    it("shared rawData is not mutated when building multiple connection payloads", async () => {
      const ctx = minimalContext();
      const f1: FeatureInterface = {
        id: "f1",
        project: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: { production: { enabled: true, rules: [] } },
      } as FeatureInterface;
      const rawData = minimalRawData({
        features: [cloneDeep(f1)],
        experimentMap: new Map(),
        groupMap: new Map(),
        safeRolloutMap: new Map(),
        savedGroups: [],
        holdoutsMap: new Map(),
      });

      const conn1: ConnectionPayloadOptions = {
        capabilities: [],
        environment: "production",
        projects: [],
      };
      const conn2: ConnectionPayloadOptions = {
        capabilities: ["bucketingV2"],
        environment: "production",
        projects: [],
      };

      await buildSDKPayloadForConnection({
        context: ctx,
        connection: conn1,
        data: rawData,
      });
      const afterFirst = {
        length: rawData.features.length,
        id: rawData.features[0]?.id,
      };
      await buildSDKPayloadForConnection({
        context: ctx,
        connection: conn2,
        data: rawData,
      });
      expect(rawData.features.length).toBe(afterFirst.length);
      expect(rawData.features[0]?.id).toBe(afterFirst.id);
    });
  });

  describe("queueSDKPayloadRefresh", () => {
    it("runs refresh and updates cache when given payloadKeys (bulk path)", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
      const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
      const upsert = jest.fn().mockResolvedValue(undefined);
      const conn = {
        key: "sdk-q1",
        organization: "org-1",
        environment: "production",
        projects: [],
      } as SDKConnectionInterface;
      findSDKConnectionsByOrganization.mockResolvedValue([conn]);
      (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(
        new Map(),
      );
      (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue(
        [],
      );
      (
        ExperimentModel.getAllURLRedirectExperiments as jest.Mock
      ).mockResolvedValue([]);
      const mockModels = {
        sdkConnectionCache: {
          deleteAllLegacyCacheEntries: deleteAllLegacy,
          upsert,
        },
        safeRollout: {
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        constants: { getAll: jest.fn().mockResolvedValue([]) },
        configs: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: {
          getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()),
        },
        rampSchedules: {
          getPayloadRampMonitoredRuleMap: jest
            .fn()
            .mockResolvedValue(new Map()),
        },
      };
      (
        global as unknown as { __mockContextModels: unknown }
      ).__mockContextModels = mockModels;

      queueSDKPayloadRefresh({
        context: minimalContext({
          models: mockModels as ReqContext["models"],
        }) as ReqContext,
        payloadKeys: [{ environment: "production", project: "p1" }],
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(findSDKConnectionsByOrganization).toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith(
        "sdk-q1",
        expect.any(String),
        undefined,
      );
    });

    it("runs refresh for given sdkConnections (targeted path)", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
      const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
      const upsert = jest.fn().mockResolvedValue(undefined);
      const conn = {
        key: "sdk-q2",
        organization: "org-1",
        environment: "production",
        projects: [],
      } as SDKConnectionInterface;
      (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(
        new Map(),
      );
      (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue(
        [],
      );
      (
        ExperimentModel.getAllURLRedirectExperiments as jest.Mock
      ).mockResolvedValue([]);
      const mockModels = {
        sdkConnectionCache: {
          deleteAllLegacyCacheEntries: deleteAllLegacy,
          upsert,
        },
        safeRollout: {
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        constants: { getAll: jest.fn().mockResolvedValue([]) },
        configs: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: {
          getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()),
        },
        rampSchedules: {
          getPayloadRampMonitoredRuleMap: jest
            .fn()
            .mockResolvedValue(new Map()),
        },
      };
      (
        global as unknown as { __mockContextModels: unknown }
      ).__mockContextModels = mockModels;

      queueSDKPayloadRefresh({
        context: minimalContext({
          models: mockModels as ReqContext["models"],
        }) as ReqContext,
        payloadKeys: [],
        sdkConnections: [conn],
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(findSDKConnectionsByOrganization).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith(
        "sdk-q2",
        expect.any(String),
        undefined,
      );
    });
  });
});
