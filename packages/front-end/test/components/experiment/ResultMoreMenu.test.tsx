import { describe, it, expect } from "vitest";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  canShowRefreshMenuItem,
  canShowReenableIncrementalRefresh,
  isExperimentExcludedFromIncrementalRefresh,
  shouldOfferMenuRefresh,
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
    it("allows refresh when forceRefresh, datasource, permission true", () => {
      const ds = makeDatasource();
      const result = canShowRefreshMenuItem({
        forceRefresh: async () => {},
        datasource: ds,
        canRunExperimentQueries: true,
      });
      expect(result).toBe(true);
    });

    it("blocks when no datasource", () => {
      const result = canShowRefreshMenuItem({
        forceRefresh: async () => {},
        datasource: null,
        canRunExperimentQueries: true,
      });
      expect(result).toBe(false);
    });

    it("blocks when no forceRefresh", () => {
      const ds = makeDatasource();
      const result = canShowRefreshMenuItem({
        forceRefresh: undefined,
        datasource: ds,
        canRunExperimentQueries: true,
      });
      expect(result).toBe(false);
    });

    it("blocks when permission denied", () => {
      const ds = makeDatasource();
      const result = canShowRefreshMenuItem({
        forceRefresh: async () => {},
        datasource: ds,
        canRunExperimentQueries: false,
      });
      expect(result).toBe(false);
    });
  });

  describe("shouldOfferMenuRefresh", () => {
    it("offers refresh for non-incremental experiments", () => {
      expect(
        shouldOfferMenuRefresh({
          isIncremental: false,
          dimension: undefined,
          overallNeedsFullRefresh: false,
        }),
      ).toBe(true);
    });

    it("offers refresh for non-incremental experiments with a dimension selected", () => {
      expect(
        shouldOfferMenuRefresh({
          isIncremental: false,
          dimension: "dim-1",
          overallNeedsFullRefresh: false,
        }),
      ).toBe(true);
    });

    it("offers refresh for incremental experiments with no dimension and no pending full refresh", () => {
      expect(
        shouldOfferMenuRefresh({
          isIncremental: true,
          dimension: undefined,
          overallNeedsFullRefresh: false,
        }),
      ).toBe(true);
    });

    it("blocks refresh for an incremental dimension run", () => {
      expect(
        shouldOfferMenuRefresh({
          isIncremental: true,
          dimension: "dim-1",
          overallNeedsFullRefresh: false,
        }),
      ).toBe(false);
    });

    it("blocks refresh when the main button already shows the full refresh CTA", () => {
      expect(
        shouldOfferMenuRefresh({
          isIncremental: true,
          dimension: undefined,
          overallNeedsFullRefresh: true,
        }),
      ).toBe(false);
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
