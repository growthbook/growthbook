import { SafeRolloutSnapshotInterface } from "shared/validators";
import { SafeRolloutSnapshotModel } from "back-end/src/models/SafeRolloutSnapshotModel";
import {
  getSafeRolloutAnalysisSummary,
  notifySafeRolloutChange,
} from "back-end/src/services/safeRolloutSnapshots";
import { updateSafeRolloutTimeSeries } from "back-end/src/services/safeRolloutTimeSeries";
import { evaluateRampScheduleAfterSafeRolloutSnapshot } from "back-end/src/services/rampScheduleEvaluator";
import {
  checkAndRollbackSafeRollout,
  updateRampUpSchedule,
} from "back-end/src/enterprise/saferollouts/safeRolloutUtils";
import { getFeature } from "back-end/src/models/FeatureModel";

jest.mock("back-end/src/services/safeRolloutSnapshots", () => ({
  getSafeRolloutAnalysisSummary: jest.fn(),
  notifySafeRolloutChange: jest.fn(),
}));

jest.mock("back-end/src/services/safeRolloutTimeSeries", () => ({
  updateSafeRolloutTimeSeries: jest.fn(),
}));

jest.mock("back-end/src/services/rampScheduleEvaluator", () => ({
  evaluateRampScheduleAfterSafeRolloutSnapshot: jest.fn(),
}));

jest.mock("back-end/src/enterprise/saferollouts/safeRolloutUtils", () => ({
  checkAndRollbackSafeRollout: jest.fn(),
  updateRampUpSchedule: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));

class TestSafeRolloutSnapshotModel extends SafeRolloutSnapshotModel {
  public latestSnapshot: SafeRolloutSnapshotInterface | undefined;

  protected updateIndexes(): void {
    return;
  }

  public async getSnapshotForSafeRollout(): Promise<
    SafeRolloutSnapshotInterface | undefined
  > {
    return this.latestSnapshot;
  }

  public async exposeAfterUpdate(
    existingDoc: SafeRolloutSnapshotInterface,
    updates: Partial<SafeRolloutSnapshotInterface>,
    updatedDoc: SafeRolloutSnapshotInterface,
  ) {
    return this.afterUpdate(existingDoc, updates, updatedDoc);
  }
}

const mockGetSafeRolloutAnalysisSummary =
  getSafeRolloutAnalysisSummary as jest.MockedFunction<
    typeof getSafeRolloutAnalysisSummary
  >;
const mockNotifySafeRolloutChange =
  notifySafeRolloutChange as jest.MockedFunction<
    typeof notifySafeRolloutChange
  >;
const mockUpdateSafeRolloutTimeSeries =
  updateSafeRolloutTimeSeries as jest.MockedFunction<
    typeof updateSafeRolloutTimeSeries
  >;
const mockEvaluateRampScheduleAfterSafeRolloutSnapshot =
  evaluateRampScheduleAfterSafeRolloutSnapshot as jest.MockedFunction<
    typeof evaluateRampScheduleAfterSafeRolloutSnapshot
  >;
const mockCheckAndRollbackSafeRollout =
  checkAndRollbackSafeRollout as jest.MockedFunction<
    typeof checkAndRollbackSafeRollout
  >;
const mockUpdateRampUpSchedule = updateRampUpSchedule as jest.MockedFunction<
  typeof updateRampUpSchedule
>;
const mockGetFeature = getFeature as jest.MockedFunction<typeof getFeature>;

function makeSnapshot(
  overrides: Partial<SafeRolloutSnapshotInterface> = {},
): SafeRolloutSnapshotInterface {
  return {
    id: "srsnp_1",
    organization: "org_1",
    dateCreated: new Date("2026-01-01T00:00:00Z"),
    dateUpdated: new Date("2026-01-01T00:00:00Z"),
    safeRolloutId: "sr_1",
    status: "success",
    runStarted: new Date("2026-01-01T00:00:00Z"),
    error: "",
    queries: [],
    settings: {
      datasourceId: "ds_1",
      exposureQueryId: "exposure_1",
      dimensions: [],
      metricSettings: [],
      goalMetrics: [],
      guardrailMetrics: [],
      activationMetric: null,
      segment: "",
      queryFilter: "",
      skipPartialData: false,
      attributionModel: "firstExposure",
    },
    multipleExposures: 0,
    triggeredBy: "schedule",
    analyses: [],
    ...overrides,
  } as SafeRolloutSnapshotInterface;
}

describe("SafeRolloutSnapshotModel ramp integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSafeRolloutAnalysisSummary.mockResolvedValue({
      snapshotId: "srsnp_1",
    });
    mockNotifySafeRolloutChange.mockResolvedValue(false);
    mockUpdateSafeRolloutTimeSeries.mockResolvedValue(undefined);
  });

  it("evaluates the linked ramp after the latest ramp-backed SafeRollout snapshot succeeds", async () => {
    const safeRollout = {
      id: "sr_1",
      organization: "org_1",
      featureId: "feat_1",
      status: "running",
      autoSnapshots: true,
      rampScheduleId: "rs_1",
    };
    const updatedSafeRollout = {
      ...safeRollout,
      analysisSummary: { snapshotId: "srsnp_1" },
    };
    const context = {
      logger: { error: jest.fn() },
      models: {
        safeRollout: {
          getById: jest.fn().mockResolvedValue(safeRollout),
          updateById: jest.fn().mockResolvedValue(updatedSafeRollout),
        },
      },
    };
    const model = new TestSafeRolloutSnapshotModel(
      context as ConstructorParameters<typeof SafeRolloutSnapshotModel>[0],
    );
    const snapshot = makeSnapshot();
    model.latestSnapshot = snapshot;

    await model.exposeAfterUpdate(snapshot, { status: "success" }, snapshot);

    expect(
      mockEvaluateRampScheduleAfterSafeRolloutSnapshot,
    ).toHaveBeenCalledWith(context, updatedSafeRollout);
    expect(mockNotifySafeRolloutChange).toHaveBeenCalledWith({
      context,
      updatedSafeRollout,
      safeRolloutSnapshot: snapshot,
    });
    expect(mockUpdateSafeRolloutTimeSeries).toHaveBeenCalledWith({
      context,
      safeRollout: updatedSafeRollout,
      safeRolloutSnapshot: snapshot,
      notificationTriggered: false,
    });
    expect(mockCheckAndRollbackSafeRollout).not.toHaveBeenCalled();
    expect(mockUpdateRampUpSchedule).not.toHaveBeenCalled();
    expect(mockGetFeature).not.toHaveBeenCalled();
  });

  it("does not evaluate the ramp for stale snapshot updates", async () => {
    const context = {
      logger: { error: jest.fn() },
      models: {
        safeRollout: {
          getById: jest.fn(),
          updateById: jest.fn(),
        },
      },
    };
    const model = new TestSafeRolloutSnapshotModel(
      context as ConstructorParameters<typeof SafeRolloutSnapshotModel>[0],
    );
    const staleSnapshot = makeSnapshot({ id: "srsnp_old" });
    model.latestSnapshot = makeSnapshot({ id: "srsnp_new" });

    await model.exposeAfterUpdate(
      staleSnapshot,
      { status: "success" },
      staleSnapshot,
    );

    expect(
      mockEvaluateRampScheduleAfterSafeRolloutSnapshot,
    ).not.toHaveBeenCalled();
    expect(context.models.safeRollout.getById).not.toHaveBeenCalled();
  });
});
