import { OrganizationInterface } from "shared/types/organization";

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: true,
}));
jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  getEffectiveAccountPlan: jest.fn(),
}));

import { getEffectiveAccountPlan } from "back-end/src/enterprise/licenseUtil";
import { getDailyTokenLimit } from "back-end/src/models/AITokenUsageModel";

const mockedPlan = getEffectiveAccountPlan as jest.MockedFunction<
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
