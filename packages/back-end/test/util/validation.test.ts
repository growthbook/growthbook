import { BadRequestError } from "back-end/src/util/errors";
import {
  MAX_IDS_QUERY_LENGTH,
  parseIdsQuery,
} from "back-end/src/util/validation";

describe("parseIdsQuery", () => {
  it("returns undefined when ids is absent or empty", () => {
    expect(parseIdsQuery(undefined)).toBeUndefined();
    expect(parseIdsQuery("")).toBeUndefined();
  });

  it("splits on commas, trims, and drops empty entries", () => {
    expect(parseIdsQuery("a,b,c")).toEqual(["a", "b", "c"]);
    expect(parseIdsQuery(" a , ,b,,")).toEqual(["a", "b"]);
    expect(parseIdsQuery(",")).toEqual([]);
  });

  it("rejects values that are not a single string", () => {
    expect(() => parseIdsQuery(["a", "b"])).toThrow(BadRequestError);
    expect(() => parseIdsQuery({ a: "b" })).toThrow(BadRequestError);
    expect(() => parseIdsQuery(5)).toThrow(
      "ids must be a comma-separated string",
    );
  });

  it("caps the number of ids", () => {
    const atLimit = Array.from(
      { length: MAX_IDS_QUERY_LENGTH },
      (_, i) => `f${i}`,
    );
    const max = MAX_IDS_QUERY_LENGTH;
    expect(parseIdsQuery(atLimit.join(","), { max })).toHaveLength(max);
    expect(() =>
      parseIdsQuery([...atLimit, "extra"].join(","), { max }),
    ).toThrow(BadRequestError);
    expect(parseIdsQuery([...atLimit, "extra"].join(","))).toHaveLength(
      max + 1,
    );
    expect(() => parseIdsQuery("a,b,c", { max: 2 })).toThrow(
      "ids cannot contain more than 2 values",
    );
  });
});
