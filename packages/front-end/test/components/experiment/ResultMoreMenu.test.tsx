import { describe, it, expect } from "vitest";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  canShowRefreshMenuItem,
  canShowReenableIncrementalRefresh,
  isExperimentExcludedFromIncrementalRefresh,
} from "@/components/Experiment/ResultMoreMenu";

const makeDatasource = (
  opts: Partial<DataSourceInterfaceWithParams> = {},
): DataSourceInterfaceWithParams =>
  ({
    id: "ds-1",
    name: "Test Datasource",
    settings: {
      pipelineSettings: {
        allowWriting: true,
        mode: "incremental",
        writeDataset: "test_dataset",
        unitsTableRetentionHours: 24,
        excludedExperimentIds: [],
        ...(opts.settings?.pipelineSettings || {}),
      },
      ...(opts.settings || {}),
    },
    ...opts,
  }) as DataSourceInterfaceWithParams;

describe("ResultMoreMenu gating helpers", () => {
  describe("canShowRefreshMenuItem", () => {
    it("allows refresh when forceRefresh, datasource, permission true, not included", () => {
      const ds = makeDatasource();
      const result = canShowRefreshMenuItem({
        forceRefresh: async () => {},
        datasource: ds,
        canRunExperimentQueries: true,
        isExperimentIncludedInIncrementalRefresh: false,
        dimension: undefined,
      });
      expect(result).toBe(true);
    });

    it("blocks when no datasource", () => {
      const result = canShowRefreshMenuItem({
        forceRefresh: async () => {},
        datasource: null,
        canRunExperimentQueries: true,
        isExperimentIncludedInIncrementalRefresh: false,
        dimension: undefined,
      });
      expect(result).toBe(false);
    });

    it("blocks when no forceRefresh", () => {
      const ds = makeDatasource();
      const result = canShowRefreshMenuItem({
        forceRefresh: undefined,
        datasource: ds,
        canRunExperimentQueries: true,
        isExperimentIncludedInIncrementalRefresh: false,
        dimension: undefined,
      });
      expect(result).toBe(false);
    });

    it("blocks when permission denied", () => {
      const ds = makeDatasource();
      const result = canShowRefreshMenuItem({
        forceRefresh: async () => {},
        datasource: ds,
        canRunExperimentQueries: false,
        isExperimentIncludedInIncrementalRefresh: false,
        dimension: undefined,
      });
      expect(result).toBe(false);
    });

    it("blocks full refresh when included and dimension set", () => {
      const ds = makeDatasource();
      const result = canShowRefreshMenuItem({
        forceRefresh: async () => {},
        datasource: ds,
        canRunExperimentQueries: true,
        isExperimentIncludedInIncrementalRefresh: true,
        dimension: "dim-1",
      });
      expect(result).toBe(false);
    });
  });

  describe("isExperimentExcludedFromIncrementalRefresh", () => {
    it("detects exclusion when incremental and id listed", () => {
      const ds = makeDatasource({
        settings: {
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
            writeDataset: "test_dataset",
            unitsTableRetentionHours: 24,
            excludedExperimentIds: ["exp-1"],
          },
        },
      });
      expect(
        isExperimentExcludedFromIncrementalRefresh({
          datasource: ds,
          experimentId: "exp-1",
        }),
      ).toBe(true);
    });

    it("returns false without datasource or experimentId", () => {
      expect(
        isExperimentExcludedFromIncrementalRefresh({
          datasource: null,
          experimentId: "exp-1",
        }),
      ).toBe(false);
      expect(
        isExperimentExcludedFromIncrementalRefresh({
          datasource: makeDatasource(),
          experimentId: undefined,
        }),
      ).toBe(false);
    });
  });

  describe("canShowReenableIncrementalRefresh", () => {
    it("shows when excluded and permission granted", () => {
      const ds = makeDatasource({
        settings: {
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
            writeDataset: "test_dataset",
            unitsTableRetentionHours: 24,
            excludedExperimentIds: ["exp-1"],
          },
        },
      });
      const result = canShowReenableIncrementalRefresh({
        datasource: ds,
        experimentId: "exp-1",
        canUpdateDataSourceSettings: true,
      });
      expect(result).toBe(true);
    });

    it("blocks when not excluded", () => {
      const ds = makeDatasource();
      const result = canShowReenableIncrementalRefresh({
        datasource: ds,
        experimentId: "exp-1",
        canUpdateDataSourceSettings: true,
      });
      expect(result).toBe(false);
    });

    it("blocks when permission denied", () => {
      const ds = makeDatasource({
        settings: {
          pipelineSettings: {
            allowWriting: true,
            mode: "incremental",
            writeDataset: "test_dataset",
            unitsTableRetentionHours: 24,
            excludedExperimentIds: ["exp-1"],
          },
        },
      });
      const result = canShowReenableIncrementalRefresh({
        datasource: ds,
        experimentId: "exp-1",
        canUpdateDataSourceSettings: false,
      });
      expect(result).toBe(false);
    });
  });
});
