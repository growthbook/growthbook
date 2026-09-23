import { vi } from "vitest";
import { FREE_ORG_LIMITS } from "shared/enterprise";
import { getStampedOrgLimits } from "back-end/src/services/plan-limits";
import { initializeGrowthBookClient } from "back-end/src/services/growthbook";

const mockEvalFeature = vi.fn();

vi.mock("back-end/src/util/secrets", () => ({
  IS_CLOUD: false,
}));

vi.mock("back-end/src/enterprise", () => ({
  getEffectiveAccountPlan: vi.fn(),
  getOrgLimits: vi.fn(),
}));

vi.mock("back-end/src/services/growthbook", () => ({
  getGrowthBookClient: () => ({ evalFeature: mockEvalFeature }),
  initializeGrowthBookClient: vi.fn().mockResolvedValue(undefined),
  getTrustedOrgAttributes: vi.fn(),
}));

describe("getStampedOrgLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("stamps the defaults when the flag value is %s", async (_label, value) => {
    mockEvalFeature.mockReturnValue({ value });
    await expect(getStampedOrgLimits()).resolves.toEqual(FREE_ORG_LIMITS);
    expect(initializeGrowthBookClient).toHaveBeenCalledTimes(1);
  });

  it("still stamps when the flag is disabled — the kill switch is read-time only", async () => {
    mockEvalFeature.mockReturnValue({ value: { enabled: false } });
    await expect(getStampedOrgLimits()).resolves.toEqual(FREE_ORG_LIMITS);
  });

  it("stamps configured limits over the defaults", async () => {
    mockEvalFeature.mockReturnValue({ value: { maxProjects: 5 } });
    await expect(getStampedOrgLimits()).resolves.toEqual({
      ...FREE_ORG_LIMITS,
      maxProjects: 5,
    });
  });

  it("evaluates the flag with the new org's plan and signup date", async () => {
    mockEvalFeature.mockReturnValue({ value: null });
    await getStampedOrgLimits();

    expect(mockEvalFeature).toHaveBeenCalledTimes(1);
    const [, { attributes }] = mockEvalFeature.mock.calls[0];
    expect(typeof attributes.accountPlan).toBe("string");
    expect(typeof attributes.orgDateCreated).toBe("string");
    expect(isNaN(new Date(attributes.orgDateCreated).getTime())).toBe(false);
  });
});
