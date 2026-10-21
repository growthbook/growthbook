import { getExperimentTimeSeries } from "back-end/src/controllers/experiments";
import {
  getFeatureDraftStates,
  getFeatureMetaInfo,
  getFeatureRampStates,
  getFeaturesDependents,
  getFeaturesHealth,
  getFeaturesStatus,
} from "back-end/src/controllers/features";
import { BadRequestError } from "back-end/src/util/errors";
import { setupApp } from "../api/api.setup";

setupApp();

const org = {
  id: "org_query_param_validation",
  name: "Query Param Validation",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: { environments: [{ id: "production", description: "" }] },
};

const reqFor = (query: Record<string, unknown>, params = {}) =>
  ({
    params,
    query,
    body: null,
    organization: org,
    userId: "u_admin",
    email: "a@t.co",
    name: "A",
    headers: {},
    audit: jest.fn(),
  }) as never;

const res = {} as never;

describe("features ids query param", () => {
  const handlers = {
    getFeatureMetaInfo,
    getFeatureDraftStates,
    getFeaturesHealth,
    getFeaturesStatus,
    getFeaturesDependents,
    getFeatureRampStates,
  };

  for (const [name, handler] of Object.entries(handlers)) {
    it(`${name} rejects an array-valued ids param`, async () => {
      await expect(
        (handler as (req: never, res: never) => Promise<unknown>)(
          reqFor({ ids: ["a", "b"] }),
          res,
        ),
      ).rejects.toThrow(BadRequestError);
    });

    it(`${name} rejects too many ids`, async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `f${i}`).join(",");
      await expect(
        (handler as (req: never, res: never) => Promise<unknown>)(
          reqFor({ ids }),
          res,
        ),
      ).rejects.toThrow("ids cannot contain more than 500 values");
    });
  }
});

describe("getExperimentTimeSeries query params", () => {
  const call = (query: Record<string, unknown>) =>
    getExperimentTimeSeries(reqFor(query, { id: "exp_1" }), res);

  it("rejects a missing metricIds", async () => {
    await expect(call({ phase: "0" })).rejects.toThrow(BadRequestError);
  });

  it("rejects empty or non-array metricIds", async () => {
    await expect(call({ phase: "0", metricIds: [] })).rejects.toThrow(
      BadRequestError,
    );
    await expect(call({ phase: "0", metricIds: "m1" })).rejects.toThrow(
      BadRequestError,
    );
    await expect(
      call({ phase: "0", metricIds: [{ $ne: "x" }] }),
    ).rejects.toThrow(BadRequestError);
  });

  it("rejects malformed dimensions", async () => {
    const base = { phase: "0", metricIds: ["m1"] };
    await expect(call({ ...base, dimensions: "pre:date" })).rejects.toThrow(
      BadRequestError,
    );
    await expect(
      call({ ...base, dimensions: [{ id: { $ne: "x" } }] }),
    ).rejects.toThrow(BadRequestError);
    await expect(
      call({ ...base, dimensions: [{ id: "d", value: ["a"] }] }),
    ).rejects.toThrow(BadRequestError);
    await expect(
      call({
        ...base,
        dimensions: Array.from({ length: 51 }, () => ({ id: "d" })),
      }),
    ).rejects.toThrow(BadRequestError);
  });
});
