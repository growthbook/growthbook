import { appendQueryParamsToURL } from "@/services/utils";

describe("appendQueryParamsToURL", () => {
  describe("when url has no query params", () => {
    it("should append query params", () => {
      const url = "http://localhost:3000";
      const queryParams = { foo: "bar" };
      const expected = "http://localhost:3000?foo=bar";

      expect(appendQueryParamsToURL(url, queryParams)).toEqual(expected);
    });
  });

  describe("when url has existing query params", () => {
    it("should append query params", () => {
      const url = "http://localhost:3000?foo=bar";
      const queryParams = { baz: "qux" };
      const expected = "http://localhost:3000?foo=bar&baz=qux";

      expect(appendQueryParamsToURL(url, queryParams)).toEqual(expected);
    });
  });

  describe("when url has existing query params and new query params have the same key", () => {
    it("should overwrite query params", () => {
      const url = "http://localhost:3000?foo=bar";
      const queryParams = { foo: "qux" };
      const expected = "http://localhost:3000?foo=qux";

      expect(appendQueryParamsToURL(url, queryParams)).toEqual(expected);
    });
  });

  describe("when url has both query params and hash", () => {
    it("should append query params", () => {
      const url = "http://localhost:3000?foo=bar#baz";
      const queryParams = { qux: "quux" };
      const expected = "http://localhost:3000?foo=bar&qux=quux#baz";

      expect(appendQueryParamsToURL(url, queryParams)).toEqual(expected);
    });
  });
});
