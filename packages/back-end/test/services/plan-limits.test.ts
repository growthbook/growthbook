import {
  FREE_ORG_LIMITS,
  PAID_PLAN_LIMITS_START_DATE,
} from "shared/enterprise";
import { getStampedOrgLimits } from "back-end/src/services/plan-limits";
import { initializeGrowthBookClient } from "back-end/src/services/growthbook";

const mockEvalFeature = jest.fn();
let mockIsCloud = true;

jest.mock("back-end/src/util/secrets", () => ({
  get IS_CLOUD() {
    return mockIsCloud;
  },
}));

jest.mock("back-end/src/enterprise", () => ({
  getEffectiveAccountPlan: jest.fn(),
  getOrgLimits: jest.fn(),
}));

jest.mock("back-end/src/services/growthbook", () => ({
  getGrowthBookClient: () => ({ evalFeature: mockEvalFeature }),
  initializeGrowthBookClient: jest.fn().mockResolvedValue(undefined),
  getTrustedOrgAttributes: jest.fn(),
}));

describe.each([
  { name: "cloud", isCloud: true },
  { name: "self-hosted", isCloud: false },
])("getStampedOrgLimits ($name)", ({ isCloud }) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCloud = isCloud;
    mockEvalFeature.mockReturnValue({ value: null });
  });

  it.each([
    { offset: -1, expected: undefined },
    { offset: 0, expected: FREE_ORG_LIMITS },
    { offset: 1, expected: FREE_ORG_LIMITS },
  ])(
    "uses the signup timestamp at cutoff offset $offset",
    async ({ offset, expected }) => {
      const dateCreated = new Date(
        PAID_PLAN_LIMITS_START_DATE.getTime() + offset,
      );
      await expect(getStampedOrgLimits({ dateCreated })).resolves.toEqual(
        expected,
      );
      expect(initializeGrowthBookClient).toHaveBeenCalledTimes(1);
    },
  );
});

describe("cloud flag overrides", () => {
  beforeEach(() => {
    mockIsCloud = true;
  });

  it("skips stamping when the flag is explicitly disabled after the cutoff", async () => {
    mockEvalFeature.mockReturnValue({ value: { enabled: false } });
    await expect(
      getStampedOrgLimits({ dateCreated: PAID_PLAN_LIMITS_START_DATE }),
    ).resolves.toBeUndefined();
  });

  it("stamps configured limits after the cutoff", async () => {
    mockEvalFeature.mockReturnValue({ value: { maxProjects: 5 } });
    await expect(
      getStampedOrgLimits({ dateCreated: PAID_PLAN_LIMITS_START_DATE }),
    ).resolves.toEqual({ ...FREE_ORG_LIMITS, maxProjects: 5 });
  });
});
