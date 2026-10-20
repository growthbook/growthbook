import { ConfigInterface } from "shared/types/config";
import { assertConfigNotLocked } from "back-end/src/services/configLock";

const baseConfig = (
  overrides: Partial<ConfigInterface> = {},
): ConfigInterface =>
  ({
    id: "cfg_1",
    organization: "org_1",
    key: "checkout",
    name: "Checkout",
    owner: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  }) as ConfigInterface;

describe("assertConfigNotLocked", () => {
  it("does not throw when the config is unlocked", () => {
    expect(() => assertConfigNotLocked(baseConfig())).not.toThrow();
    expect(() =>
      assertConfigNotLocked(baseConfig({ lock: null })),
    ).not.toThrow();
  });

  it("throws mentioning the pinned version when locked", () => {
    const config = baseConfig({
      lock: {
        revisionId: "rev_1",
        version: 5,
        lockedBy: "u_1",
        dateLocked: new Date(),
      },
    });
    expect(() => assertConfigNotLocked(config)).toThrow(
      /locked at revision v5/,
    );
  });
});
