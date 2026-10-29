import { DataSourceInterface } from "shared/types/datasource";
import { ApiReqContext } from "back-end/types/api";
import { resolveSnapshotExposureSource } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { UnrecoverableSnapshotError } from "back-end/src/util/errors";

const datasource = {
  id: "ds_1",
  settings: {
    queries: {
      exposure: [
        {
          id: "eq_1",
          name: "Experiments",
          query: "SELECT * FROM experiment_viewed",
          userIdType: "user_id",
        },
      ],
    },
  },
} as unknown as DataSourceInterface;

function makeContext({
  cb,
  cbQuery,
}: {
  cb?: { contextualBanditQueryId?: string } | null;
  cbQuery?: { query: string; userIdType: string } | null;
}) {
  return {
    models: {
      contextualBandits: { getById: jest.fn().mockResolvedValue(cb ?? null) },
      contextualBanditQueries: {
        getById: jest.fn().mockResolvedValue(cbQuery ?? null),
      },
    },
  } as unknown as Pick<ApiReqContext, "models">;
}

describe("resolveSnapshotExposureSource", () => {
  it("uses the datasource assignment query for an ordinary experiment", async () => {
    const context = makeContext({});
    const result = await resolveSnapshotExposureSource(context, datasource, {
      exposureQueryId: "eq_1",
      exposureQueryIdentifierType: "user_id",
    });
    expect(result.exposureQuery?.id).toBe("eq_1");
    expect(result.resolvedExposureQuery).toEqual({
      query: "SELECT * FROM experiment_viewed",
      identifierType: "user_id",
    });
    expect(context.models.contextualBandits.getById).not.toHaveBeenCalled();
  });

  it("reads a measurement arm through the bandit's own query", async () => {
    const context = makeContext({
      cb: { contextualBanditQueryId: "cbq_1" },
      cbQuery: { query: "SELECT * FROM cb_viewed", userIdType: "anonymous_id" },
    });
    const result = await resolveSnapshotExposureSource(context, datasource, {
      contextualBanditId: "cb_1",
      exposureQueryId: "",
      exposureQueryIdentifierType: undefined,
    });
    expect(result.exposureQuery).toBeUndefined();
    expect(result.resolvedExposureQuery).toEqual({
      query: "SELECT * FROM cb_viewed",
      identifierType: "anonymous_id",
    });
    expect(context.models.contextualBandits.getById).toHaveBeenCalledWith(
      "cb_1",
    );
  });

  it("fails unrecoverably when the bandit or its query is gone", async () => {
    await expect(
      resolveSnapshotExposureSource(makeContext({ cb: null }), datasource, {
        contextualBanditId: "cb_missing",
        exposureQueryId: "",
      }),
    ).rejects.toBeInstanceOf(UnrecoverableSnapshotError);
    await expect(
      resolveSnapshotExposureSource(
        makeContext({ cb: { contextualBanditQueryId: "cbq_gone" } }),
        datasource,
        { contextualBanditId: "cb_1", exposureQueryId: "" },
      ),
    ).rejects.toThrow(/Contextual Bandit Query not found/);
  });
});
