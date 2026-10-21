import type { Response } from "express";
import {
  getSnapshot,
  getSnapshotSummary,
  getSnapshotWithDimension,
} from "back-end/src/controllers/experiments";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  getLatestSnapshotStatus,
  getLatestSuccessfulSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { BadRequestError } from "back-end/src/util/errors";

// Stubbed wholesale: requireActual of this module trips an import cycle.
jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: jest.fn(),
  getEnvironmentIdsFromOrg: jest.fn(() => []),
}));
jest.mock("back-end/src/models/ExperimentModel", () => {
  const actual = jest.requireActual("back-end/src/models/ExperimentModel");
  const getExperimentByIdMock = jest.fn();
  return new Proxy(actual, {
    get: (target, key) =>
      key === "getExperimentById"
        ? getExperimentByIdMock
        : Reflect.get(target, key),
  });
});
jest.mock("back-end/src/models/ExperimentSnapshotModel", () => {
  const actual = jest.requireActual(
    "back-end/src/models/ExperimentSnapshotModel",
  );
  const latestSuccessful = jest.fn();
  const latestStatus = jest.fn();
  return new Proxy(actual, {
    get: (target, key) =>
      key === "getLatestSuccessfulSnapshot"
        ? latestSuccessful
        : key === "getLatestSnapshotStatus"
          ? latestStatus
          : Reflect.get(target, key),
  });
});

// What `?type[$ne]=standard` and `?dimension[$ne]=` parse to with Express's
// extended query parser.
const operatorObject = { $ne: "standard" };

describe("experiment snapshot routes: query params", () => {
  const makeRes = () =>
    ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }) as unknown as Response;

  const makeReq = (
    query: Record<string, unknown>,
    params: Record<string, string> = {},
  ) =>
    ({
      params: { id: "exp_1", phase: "0", ...params },
      query,
    }) as never;

  beforeEach(() => {
    (getContextFromReq as jest.Mock).mockReturnValue({
      org: { id: "org_1" },
    });
    (getExperimentById as jest.Mock).mockResolvedValue({
      id: "exp_1",
      organization: "org_1",
      phases: [{}],
    });
    (getLatestSuccessfulSnapshot as jest.Mock).mockResolvedValue(null);
    (getLatestSnapshotStatus as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => jest.clearAllMocks());

  describe.each([
    ["getSnapshot", getSnapshot],
    ["getSnapshotWithDimension", getSnapshotWithDimension],
    ["getSnapshotSummary", getSnapshotSummary],
  ] as const)("%s", (_name, handler) => {
    const params = { dimension: "pre:date" };

    it.each([
      ["operator object", operatorObject],
      ["array", ["standard", "report"]],
      ["nested object", { a: { b: "c" } }],
      ["unknown type", "bogus"],
      ["unknown type (prototype key)", "__proto__"],
    ])("rejects an invalid `type` (%s) with a 400", async (_label, type) => {
      await expect(
        handler(makeReq({ type }, params), makeRes()),
      ).rejects.toThrow(BadRequestError);
      expect(getLatestSuccessfulSnapshot).not.toHaveBeenCalled();
      expect(getLatestSnapshotStatus).not.toHaveBeenCalled();
    });

    it.each(["standard", "exploratory", "report"])(
      "passes a valid type %s through",
      async (type) => {
        await handler(makeReq({ type }, params), makeRes());
        const mock =
          handler === getSnapshotSummary
            ? getLatestSnapshotStatus
            : getLatestSuccessfulSnapshot;
        expect(mock).toHaveBeenCalledWith(expect.objectContaining({ type }));
      },
    );

    it.each([[{}], [{ type: "" }], [{ type: undefined }]])(
      "treats an absent type (%j) as undefined",
      async (query) => {
        await handler(makeReq(query, params), makeRes());
        const mock =
          handler === getSnapshotSummary
            ? getLatestSnapshotStatus
            : getLatestSuccessfulSnapshot;
        expect(mock).toHaveBeenCalledWith(
          expect.objectContaining({ type: undefined }),
        );
      },
    );
  });

  describe("getSnapshotSummary dimension", () => {
    it.each([
      ["operator object", operatorObject],
      ["array", ["a", "b"]],
    ])(
      "rejects a non-string dimension (%s) with a 400",
      async (_l, dimension) => {
        await expect(
          getSnapshotSummary(makeReq({ dimension }), makeRes()),
        ).rejects.toThrow(BadRequestError);
        expect(getLatestSnapshotStatus).not.toHaveBeenCalled();
      },
    );

    it("passes a string dimension through and treats absent/empty as undefined", async () => {
      await getSnapshotSummary(makeReq({ dimension: "pre:date" }), makeRes());
      expect(getLatestSnapshotStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ dimension: "pre:date" }),
      );

      await getSnapshotSummary(makeReq({ dimension: "" }), makeRes());
      expect(getLatestSnapshotStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ dimension: undefined }),
      );

      await getSnapshotSummary(makeReq({}), makeRes());
      expect(getLatestSnapshotStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ dimension: undefined }),
      );
    });
  });
});
