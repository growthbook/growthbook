import { MockedFunction, vi } from "vitest";
import { OrganizationInterface } from "shared/types/organization";

vi.mock("back-end/src/util/secrets", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/secrets")>(
    "back-end/src/util/secrets",
  )),
  IS_CLOUD: true,
}));
vi.mock("back-end/src/enterprise/licenseUtil", () => ({
  getEffectiveAccountPlan: vi.fn(),
}));

import { getEffectiveAccountPlan } from "back-end/src/enterprise/licenseUtil";
import { getDailyTokenLimit } from "back-end/src/models/AITokenUsageModel";

const mockedPlan = getEffectiveAccountPlan as MockedFunction<
  typeof getEffectiveAccountPlan
>;

const org = { id: "org_1" } as OrganizationInterface;

describe("getDailyTokenLimit", () => {
  it("removes the cap for enterprise orgs", () => {
    mockedPlan.mockReturnValue("enterprise");

    expect(getDailyTokenLimit(org, 1_000_000)).toBe(Infinity);
  });

  it.each(["starter", "pro", "pro_sso"] as const)(
    "keeps the stored cap for %s orgs",
    (plan) => {
      mockedPlan.mockReturnValue(plan);

      expect(getDailyTokenLimit(org, 1_000_000)).toBe(1_000_000);
    },
  );
});
