import { Environment } from "shared/types/organization";
import { ReqContext } from "back-end/types/request";
import { cleanupUpdatedEnvironment } from "back-end/src/services/environments";

jest.mock("back-end/src/models/SdkConnectionModel", () => ({}));
jest.mock("back-end/src/models/SlackIntegrationModel", () => ({}));

describe("cleanupUpdatedEnvironment", () => {
  const dev: Environment = { id: "dev", description: "", isProduction: false };

  const run = async (previous: Environment, updated: Environment) => {
    const deleteByEnvironment = jest.fn().mockResolvedValue([]);
    const context = {
      models: { experimentQaOverrides: { deleteByEnvironment } },
    } as unknown as ReqContext;
    await cleanupUpdatedEnvironment(context, previous, updated);
    return deleteByEnvironment;
  };

  it("deletes the environment's QA overrides when it becomes production", async () => {
    const deleteByEnvironment = await run(dev, { ...dev, isProduction: true });
    expect(deleteByEnvironment).toHaveBeenCalledWith("dev");
  });

  it("keeps them when the environment stays non-production", async () => {
    const deleteByEnvironment = await run(dev, {
      ...dev,
      description: "still for testing",
    });
    expect(deleteByEnvironment).not.toHaveBeenCalled();
  });

  it("keeps them when a production environment is edited", async () => {
    const production = { ...dev, isProduction: true };
    const deleteByEnvironment = await run(production, {
      ...production,
      description: "renamed",
    });
    expect(deleteByEnvironment).not.toHaveBeenCalled();
  });
});
