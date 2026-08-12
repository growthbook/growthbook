import { ExperimentAggregateUnitsQueryResponseRows } from "shared/types/integrations";
import {
  runIsolatedAnalysisStep,
  runTrafficAnalysisStep,
} from "back-end/src/queryRunners/analysisSteps";
import { analyzeExperimentTraffic } from "back-end/src/services/stats";
import { logger } from "back-end/src/util/logger";

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("back-end/src/services/stats", () => ({
  analyzeExperimentTraffic: jest.fn(),
}));

const mockedLoggerError = logger.error as jest.Mock;
const mockedAnalyzeExperimentTraffic = analyzeExperimentTraffic as jest.Mock;

describe("runIsolatedAnalysisStep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the step's value with a null error on success", () => {
    const step = runIsolatedAnalysisStep({
      step: "power",
      modelId: "snp_1",
      run: () => ({ power: 0.8 }),
    });

    expect(step).toEqual({ value: { power: 0.8 }, error: null });
    expect(mockedLoggerError).not.toHaveBeenCalled();
  });

  it("treats an undefined return as success, not as a failure", () => {
    // analyzeExperimentPower legitimately returns undefined when its result
    // fails validation, so `error === null` (not the value) is the success test.
    const step = runIsolatedAnalysisStep({
      step: "power",
      modelId: "snp_1",
      run: () => undefined,
    });

    expect(step.error).toBeNull();
    expect(step.value).toBeUndefined();
  });

  it("catches a throw, returns its message, and logs it against the model", () => {
    const step = runIsolatedAnalysisStep({
      step: "covariateImbalance",
      modelId: "snp_1",
      run: () => {
        throw new Error("Cannot read properties of undefined");
      },
    });

    expect(step).toEqual({
      value: null,
      error: "Cannot read properties of undefined",
    });
    expect(mockedLoggerError).toHaveBeenCalledTimes(1);
    expect(mockedLoggerError.mock.calls[0][1]).toBe(
      'snp_1 runner: "covariateImbalance" analysis step failed',
    );
  });

  it("stringifies a non-Error throw", () => {
    const step = runIsolatedAnalysisStep({
      step: "traffic",
      modelId: "snp_1",
      run: () => {
        throw "boom";
      },
    });

    expect(step.error).toBe("boom");
    expect(step.value).toBeNull();
  });
});

describe("runTrafficAnalysisStep", () => {
  const rows = [
    { variation: "0", users: 100 },
  ] as unknown as ExperimentAggregateUnitsQueryResponseRows;
  const variations = [
    { id: "0", weight: 0.5 },
    { id: "1", weight: 0.5 },
  ];
  const traffic = {
    overall: { name: "All", srm: 1, variationUnits: [100, 100] },
    dimension: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the traffic block unchanged when the step succeeds", () => {
    mockedAnalyzeExperimentTraffic.mockReturnValue(traffic);

    expect(
      runTrafficAnalysisStep({
        modelId: "snp_1",
        rows,
        queryError: undefined,
        variations,
      }),
    ).toEqual({ traffic, error: null });
    expect(mockedAnalyzeExperimentTraffic).toHaveBeenCalledTimes(1);
  });

  it("re-derives an empty traffic block carrying the error when the step throws", () => {
    mockedAnalyzeExperimentTraffic
      .mockImplementationOnce(() => {
        throw new Error("traffic aggregation failed");
      })
      .mockImplementationOnce(({ error }: { error?: string }) => ({
        ...traffic,
        error,
      }));

    const result = runTrafficAnalysisStep({
      modelId: "snp_1",
      rows,
      queryError: undefined,
      variations,
    });

    // A traffic block always exists, and carries the reason it is empty.
    expect(result.traffic.error).toBe("traffic aggregation failed");
    expect(result.error).toBe("traffic aggregation failed");
    // The fallback must not re-run the analysis over the same rows.
    expect(mockedAnalyzeExperimentTraffic).toHaveBeenLastCalledWith({
      rows: [],
      error: "traffic aggregation failed",
      variations,
    });
  });
});
