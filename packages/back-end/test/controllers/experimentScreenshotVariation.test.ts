import type { Response } from "express";
import {
  addScreenshot,
  deleteScreenshot,
} from "back-end/src/controllers/experiments";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { parseArrayIndex } from "back-end/src/util/validation";

// Stubbed wholesale: requireActual of this module trips an import cycle.
jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: jest.fn(),
  getEnvironmentIdsFromOrg: jest.fn(() => []),
}));
jest.mock("back-end/src/models/ExperimentModel", () => {
  const actual = jest.requireActual("back-end/src/models/ExperimentModel");
  const getExperimentByIdMock = jest.fn();
  const updateExperimentMock = jest.fn();
  return new Proxy(actual, {
    get: (target, key) =>
      key === "getExperimentById"
        ? getExperimentByIdMock
        : key === "updateExperiment"
          ? updateExperimentMock
          : Reflect.get(target, key),
  });
});
jest.mock(
  "back-end/src/services/experimentChanges/changeExperimentStatus",
  () => ({
    ...jest.requireActual(
      "back-end/src/services/experimentChanges/changeExperimentStatus",
    ),
    validateExperimentChange: jest.fn(),
  }),
);

describe("parseArrayIndex", () => {
  it("accepts in-range integers and their decimal string form", () => {
    expect(parseArrayIndex(0, 2)).toBe(0);
    expect(parseArrayIndex(1, 2)).toBe(1);
    expect(parseArrayIndex("0", 2)).toBe(0);
    expect(parseArrayIndex("1", 2)).toBe(1);
  });

  it.each([
    "__proto__",
    "constructor",
    "length",
    "abc",
    "",
    "-1",
    "1.5",
    "1e0",
    " 1",
    "0x1",
    "999",
    "2",
    2,
    -1,
    1.5,
    NaN,
    Infinity,
    null,
    undefined,
    {},
    ["1"],
  ])("rejects %p", (value) => {
    expect(parseArrayIndex(value, 2)).toBeUndefined();
  });
});

describe("experiment screenshot routes: variation param", () => {
  const makeExperiment = () => ({
    id: "exp_1",
    organization: "org_1",
    variations: [
      { id: "v0", name: "Control", screenshots: [] },
      { id: "v1", name: "Variation", screenshots: [] },
    ],
  });

  const makeRes = () =>
    ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }) as unknown as Response;

  const makeReq = (variation: string) =>
    ({
      params: { id: "exp_1", variation },
      body: { url: "https://example.com/a.png", description: "d" },
      audit: jest.fn(),
    }) as never;

  beforeEach(() => {
    (getContextFromReq as jest.Mock).mockReturnValue({
      org: { id: "org_1" },
      userId: "u_1",
      models: { watch: { upsertWatch: jest.fn() } },
      permissions: {
        canUpdateExperiment: () => true,
        throwPermissionError: () => {
          throw new Error("permission denied");
        },
      },
    });
    (getExperimentById as jest.Mock).mockImplementation(async () =>
      makeExperiment(),
    );
    (updateExperiment as jest.Mock).mockResolvedValue(makeExperiment());
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Never leave pollution behind for other tests, even if an assertion fails.
    delete (Array.prototype as unknown as Record<string, unknown>).screenshots;
  });

  it.each(["__proto__", "constructor", "abc", "-1", "999", "2", "1.5", ""])(
    "addScreenshot rejects variation %p without mutating Array.prototype",
    async (variation) => {
      const res = makeRes();
      await addScreenshot(makeReq(variation), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(updateExperiment).not.toHaveBeenCalled();
      expect(
        Object.prototype.hasOwnProperty.call(Array.prototype, "screenshots"),
      ).toBe(false);
      expect(([] as unknown as Record<string, unknown>).screenshots).toBe(
        undefined,
      );
    },
  );

  it.each(["__proto__", "constructor", "abc", "-1", "999", "2", "1.5", ""])(
    "deleteScreenshot rejects variation %p without mutating Array.prototype",
    async (variation) => {
      const res = makeRes();
      await deleteScreenshot(makeReq(variation), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(updateExperiment).not.toHaveBeenCalled();
      expect(
        Object.prototype.hasOwnProperty.call(Array.prototype, "screenshots"),
      ).toBe(false);
    },
  );

  it("addScreenshot adds a screenshot to the variation at a valid index", async () => {
    const res = makeRes();
    await addScreenshot(makeReq("1"), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const { changes } = (updateExperiment as jest.Mock).mock.calls[0][0];
    expect(changes.variations[0].screenshots).toEqual([]);
    expect(changes.variations[1].screenshots).toEqual([
      { path: "https://example.com/a.png", description: "d" },
    ]);
  });

  it("deleteScreenshot removes a screenshot at a valid index", async () => {
    (getExperimentById as jest.Mock).mockImplementation(async () => {
      const exp = makeExperiment();
      exp.variations[0].screenshots = [
        { path: "https://example.com/a.png" },
        { path: "https://example.com/b.png" },
      ] as never;
      return exp;
    });
    const res = makeRes();
    await deleteScreenshot(makeReq("0"), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const { changes } = (updateExperiment as jest.Mock).mock.calls[0][0];
    expect(changes.variations[0].screenshots).toEqual([
      { path: "https://example.com/b.png" },
    ]);
  });
});
