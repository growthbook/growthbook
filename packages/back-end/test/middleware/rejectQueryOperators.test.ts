import { Request, Response } from "express";
import {
  findOperatorKey,
  rejectQueryOperators,
} from "back-end/src/middleware/rejectQueryOperators";

describe("findOperatorKey", () => {
  it("ignores plain and nested non-operator values", () => {
    expect(findOperatorKey({})).toBeNull();
    expect(findOperatorKey({ id: "abc", ids: ["a", "b"] })).toBeNull();
    expect(
      findOperatorKey({ dimensions: [{ id: "x", value: "y" }] }),
    ).toBeNull();
    expect(findOperatorKey(undefined)).toBeNull();
  });

  it("names the first $-prefixed key at any depth", () => {
    expect(findOperatorKey({ $where: "1" })).toBe("$where");
    expect(findOperatorKey({ id: { $ne: "" } })).toBe("id.$ne");
    expect(findOperatorKey({ ids: [{ $gt: "" }] })).toBe("ids[0].$gt");
    expect(findOperatorKey({ a: { b: { $regex: "^x" } } })).toBe("a.b.$regex");
  });
});

describe("rejectQueryOperators", () => {
  function run(query: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const next = jest.fn();
    rejectQueryOperators(
      { query } as Request,
      { status } as unknown as Response,
      next,
    );
    return { status, json, next };
  }

  it("passes a clean query through", () => {
    const { status, next } = run({ project: "prj_1", ids: ["a"] });
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("responds 400 and stops the chain on an operator", () => {
    const { status, json, next } = run({ trackingKey: { $ne: "" } });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      status: 400,
      message: "Invalid query parameter: trackingKey.$ne",
    });
  });
});
