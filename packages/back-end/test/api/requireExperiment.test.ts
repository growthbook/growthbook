import { ExperimentInterface } from "shared/types/experiment";
import { ApiReqContext } from "back-end/types/api";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  requireEditableExperiment,
  requireExperiment,
} from "back-end/src/api/experiments/requireExperiment";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

const getExperimentByIdMock = getExperimentById as jest.Mock;
const context = {} as ApiReqContext;

function experimentOfType(type: string): ExperimentInterface {
  return { id: "exp_1", type } as unknown as ExperimentInterface;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("requireExperiment", () => {
  it("returns a standard experiment and a measurement arm", async () => {
    getExperimentByIdMock.mockResolvedValueOnce(experimentOfType("standard"));
    await expect(requireExperiment(context, "exp_1")).resolves.toMatchObject({
      type: "standard",
    });
    getExperimentByIdMock.mockResolvedValueOnce(
      experimentOfType("contextualBanditMeasurementArm"),
    );
    await expect(requireExperiment(context, "exp_1")).resolves.toMatchObject({
      type: "contextualBanditMeasurementArm",
    });
  });

  it("rejects holdouts and missing experiments", async () => {
    getExperimentByIdMock.mockResolvedValueOnce(experimentOfType("holdout"));
    await expect(requireExperiment(context, "exp_1")).rejects.toThrow(
      /Holdouts/,
    );
    getExperimentByIdMock.mockResolvedValueOnce(null);
    await expect(requireExperiment(context, "exp_1")).rejects.toThrow(
      /not found/,
    );
  });
});

describe("requireEditableExperiment", () => {
  it("returns a standard experiment", async () => {
    getExperimentByIdMock.mockResolvedValueOnce(experimentOfType("standard"));
    await expect(
      requireEditableExperiment(context, "exp_1", "delete via this API"),
    ).resolves.toMatchObject({ type: "standard" });
  });

  it("rejects a measurement arm with the attempted action", async () => {
    getExperimentByIdMock.mockResolvedValueOnce(
      experimentOfType("contextualBanditMeasurementArm"),
    );
    await expect(
      requireEditableExperiment(context, "exp_1", "delete via this API"),
    ).rejects.toThrow(/Cannot delete via this API.*Contextual Bandit/);
  });
});
