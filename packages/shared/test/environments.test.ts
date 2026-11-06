import {
  DEFAULT_ENVIRONMENT_IDS,
  guessIsProductionEnvironment,
  isProductionEnvironment,
  withIsProduction,
} from "../src/util/environments";

describe("guessIsProductionEnvironment", () => {
  it.each(["dev", "Dev", "DEV", "staging", "test"])(
    "treats the default non-production name %s as non-production",
    (id) => {
      expect(guessIsProductionEnvironment(id)).toBe(false);
    },
  );

  it.each([
    "production",
    "prod",
    "dev2",
    "john_dev",
    "dev-prod",
    "preprod",
    "qa",
    "development",
  ])("treats %s as production (exact match only)", (id) => {
    expect(guessIsProductionEnvironment(id)).toBe(true);
  });
});

describe("DEFAULT_ENVIRONMENT_IDS", () => {
  it("treats every default except production as non-production", () => {
    expect(DEFAULT_ENVIRONMENT_IDS).toContain("production");
    expect(guessIsProductionEnvironment("production")).toBe(true);
    DEFAULT_ENVIRONMENT_IDS.filter((id) => id !== "production").forEach(
      (id) => {
        expect(guessIsProductionEnvironment(id)).toBe(false);
      },
    );
  });
});

describe("isProductionEnvironment", () => {
  it("prefers the saved value over the guess", () => {
    expect(isProductionEnvironment({ id: "dev", isProduction: true })).toBe(
      true,
    );
    expect(
      isProductionEnvironment({ id: "production", isProduction: false }),
    ).toBe(false);
  });

  it("falls back to the guess when nothing is saved", () => {
    expect(isProductionEnvironment({ id: "dev" })).toBe(false);
    expect(isProductionEnvironment({ id: "production" })).toBe(true);
  });
});

describe("withIsProduction", () => {
  it("fills a missing value and keeps an explicit one", () => {
    expect(withIsProduction({ id: "dev", description: "" })).toEqual({
      id: "dev",
      description: "",
      isProduction: false,
    });
    expect(withIsProduction({ id: "dev", isProduction: true })).toEqual({
      id: "dev",
      isProduction: true,
    });
  });
});
