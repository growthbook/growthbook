import {
  parseOptionalQueryString,
  parseSnapshotTypeQuery,
} from "back-end/src/util/snapshotQueryParams";
import { BadRequestError } from "back-end/src/util/errors";

describe("parseOptionalQueryString", () => {
  it("returns strings as-is", () => {
    expect(parseOptionalQueryString("dimension", "dim_country")).toBe(
      "dim_country",
    );
  });

  it.each([undefined, ""])("treats %p as not provided", (value) => {
    expect(parseOptionalQueryString("dimension", value)).toBeUndefined();
  });

  it.each([{ $ne: "x" }, ["a", "b"], 1, null])("rejects %p", (value) => {
    const parse = () => parseOptionalQueryString("dimension", value);
    expect(parse).toThrow(BadRequestError);
    expect(parse).toThrow("Invalid dimension");
  });
});

describe("parseSnapshotTypeQuery", () => {
  it.each(["standard", "exploratory", "report"])("accepts %p", (value) => {
    expect(parseSnapshotTypeQuery(value)).toBe(value);
  });

  it.each([undefined, ""])("treats %p as not provided", (value) => {
    expect(parseSnapshotTypeQuery(value)).toBeUndefined();
  });

  it.each(["other", "Standard", { $ne: "standard" }, ["standard"], null])(
    "rejects %p",
    (value) => {
      const parse = () => parseSnapshotTypeQuery(value);
      expect(parse).toThrow(BadRequestError);
      expect(parse).toThrow("Invalid type");
    },
  );
});
