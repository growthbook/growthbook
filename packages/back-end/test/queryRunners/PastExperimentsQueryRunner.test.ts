import { PastExperimentsInterface } from "shared/types/past-experiments";
import { PastExperimentsQueryRunner } from "back-end/src/queryRunners/PastExperimentsQueryRunner";
import { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { ReqContext } from "back-end/types/request";

function getRunner(model: PastExperimentsInterface) {
  const context = {
    permissions: {
      canRunPastExperimentQueries: () => true,
      throwPermissionError: () => {
        throw new Error("Permission denied");
      },
    },
  } as unknown as ReqContext;

  const integration = {
    datasource: { id: "ds_1" },
  } as unknown as SourceIntegrationInterface;

  return new PastExperimentsQueryRunner(context, model, integration);
}

describe("PastExperimentsQueryRunner", () => {
  it("merges normalized stored weights using user counts", async () => {
    const model: PastExperimentsInterface = {
      id: "imp_1",
      organization: "org_1",
      datasource: "ds_1",
      runStarted: new Date(),
      queries: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      experiments: [
        {
          trackingKey: "exp_1",
          experimentName: "Experiment 1",
          variationKeys: ["0", "1"],
          variationNames: ["Control", "Treatment"],
          numVariations: 2,
          weights: [0.9, 0.1],
          users: 100,
          startDate: new Date("2024-01-01"),
          endDate: new Date("2024-01-10"),
          exposureQueryId: "eq_1",
        },
      ],
    };

    const runner = getRunner(model);
    const queryMap: QueryMap = new Map([
      [
        "experiments",
        {
          // Merge a new batch where only variation "1" gets new users.
          result: {
            mergeResults: true,
            experiments: [
              {
                experiment_id: "exp_1",
                experiment_name: "Experiment 1",
                variation_id: "1",
                variation_name: "Treatment",
                users: 100,
                start_date: new Date("2024-01-11"),
                end_date: new Date("2024-01-20"),
                latest_data: new Date("2024-01-20"),
                exposureQueryId: "eq_1",
                start_of_range: false,
              },
            ],
          },
        } as never,
      ],
    ]);

    const result = await runner.runAnalysis(queryMap);
    expect(result).toHaveLength(1);
    expect(result[0].users).toBe(200);
    // Existing [0.9, 0.1] over 100 users => [90, 10], then +100 on variation 1
    // gives [90, 110] => [0.45, 0.55] after rounding/normalization.
    expect(result[0].weights).toEqual([0.45, 0.55]);
  });
});
