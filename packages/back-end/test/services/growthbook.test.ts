import { parseAppFeatureDefaults } from "back-end/src/services/growthbook";
import { logger } from "back-end/src/util/logger";

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("parseAppFeatureDefaults", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns an empty object when unset", () => {
    expect(parseAppFeatureDefaults("")).toEqual({});
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("parses a JSON object of feature keys to values", () => {
    expect(
      parseAppFeatureDefaults(
        JSON.stringify({
          "boolean-flag": true,
          "string-flag": "hello",
          "number-flag": 42,
          "json-flag": { nested: ["a", "b"] },
          "null-flag": null,
        }),
      ),
    ).toEqual({
      "boolean-flag": true,
      "string-flag": "hello",
      "number-flag": 42,
      "json-flag": { nested: ["a", "b"] },
      "null-flag": null,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns an empty object and logs on invalid JSON", () => {
    expect(parseAppFeatureDefaults("{not json")).toEqual({});
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns an empty object and logs when JSON is not an object", () => {
    expect(parseAppFeatureDefaults('["my-flag"]')).toEqual({});
    expect(parseAppFeatureDefaults('"my-flag"')).toEqual({});
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
