import fetch, { Response } from "node-fetch";
import * as Sentry from "@sentry/node";
import { OrganizationInterface } from "shared/types/organization";
import {
  backgroundUpdateUsageDataFromServerForTests,
  getUsage,
  getUsageFromCache,
  getUsages,
  setUsageInCache,
  resetUsageCache,
  UNLIMITED_USAGE,
} from "back-end/src/enterprise/billing";
import * as licenseUtil from "back-end/src/enterprise/licenseUtil";

jest.mock("@sentry/node", () => ({
  ...jest.requireActual("@sentry/node"),
  captureException: jest.fn(),
}));

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  ...jest.requireActual("back-end/src/enterprise/licenseUtil"),
  getEffectiveAccountPlan: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
  },
}));

let isCloud = false;

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  get IS_CLOUD() {
    return isCloud; // Use a getter to dynamically return the value of isCloud
  },
}));
jest.mock("node-fetch");

const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

const mockOrgId = "org_123";
const mockOrgId2 = "org_456";

const mockOrganization: OrganizationInterface = {
  id: mockOrgId,
  name: "Test Organization",
  dateCreated: new Date(),
  members: [],
  invites: [],
  url: "",
  ownerEmail: "",
};

const mockOrganization2: OrganizationInterface = {
  id: mockOrgId2,
  name: "Test Organization 2",
  dateCreated: new Date(),
  members: [],
  invites: [],
  url: "",
  ownerEmail: "",
};

const mockResponse = {
  [mockOrgId]: {
    limits: {
      requests: 1_000,
      bandwidth: 10_000_000_000,
      managedClickhouseEvents: 1_000_000,
    },
    cdn: { lastUpdated: new Date(), status: "under" as const },
    managedClickhouse: { lastUpdated: new Date(), status: "under" as const },
  },
};

const mockResponse2 = {
  [mockOrgId]: {
    limits: {
      requests: 2_000,
      bandwidth: 20_000_000_000,
      managedClickhouseEvents: 2_000_000,
    },
    cdn: { lastUpdated: new Date(), status: "over" as const },
    managedClickhouse: {
      lastUpdated: new Date(),
      status: "approaching" as const,
    },
  },
};

const mockMultiOrgResponse = {
  [mockOrgId]: {
    limits: {
      requests: 3_000,
      bandwidth: 30_000_000_000,
      managedClickhouseEvents: 3_000_000,
    },
    cdn: { lastUpdated: new Date(), status: "under" as const },
    managedClickhouse: { lastUpdated: new Date(), status: "under" as const },
  },
  [mockOrgId2]: {
    limits: {
      requests: 4_000,
      bandwidth: 40_000_000_000,
      managedClickhouseEvents: 4_000_000,
    },
    cdn: { lastUpdated: new Date(), status: "approaching" as const },
    managedClickhouse: { lastUpdated: new Date(), status: "over" as const },
  },
};

describe("getUsage", () => {
  const env = process.env;
  const now = new Date("2023-11-21T12:08:12.610Z");
  const twoHoursFromNow = new Date("2023-11-21T14:08:12.610Z");

  beforeEach(() => {
    resetUsageCache();
    jest.clearAllMocks();
    jest.useFakeTimers("modern");
    jest.setSystemTime(now);
    process.env = { ...env };
  });

  afterEach(() => {
    jest.useRealTimers();
    mockedFetch.mockReset();
    process.env = env;
  });

  describe("IS_CLOUD = false", () => {
    beforeEach(() => {
      isCloud = false;
    });

    it("should return UNLIMITED_USAGE if not in cloud mode", async () => {
      const usage = await getUsage(mockOrganization);

      expect(usage).toEqual(UNLIMITED_USAGE);
      expect(mockedFetch).toHaveBeenCalledTimes(0);
    });

    it("should return UNLIMITED_USAGE getUsageFromCache", async () => {
      const usage = await getUsageFromCache(mockOrganization);
      expect(usage).toEqual(UNLIMITED_USAGE);

      // Since it is not cloud, it should not fetch even in the background
      await backgroundUpdateUsageDataFromServerForTests;
      expect(mockedFetch).toHaveBeenCalledTimes(0);
    });
  });

  describe("IS_CLOUD = true", () => {
    beforeEach(() => {
      isCloud = true;
    });

    describe("pro plan", () => {
      beforeEach(() => {
        (licenseUtil.getEffectiveAccountPlan as jest.Mock).mockReturnValue(
          "pro",
        );
      });

      it("should return UNLIMITED_USAGE for plans with unlimited usage", async () => {
        const usage = await getUsage(mockOrganization);

        expect(usage).toEqual(UNLIMITED_USAGE);
        expect(mockedFetch).toHaveBeenCalledTimes(0);
      });

      describe("with existing usage data in cache from when it was free", () => {
        beforeEach(() => {
          setUsageInCache(mockOrgId, {
            limits: {
              requests: 10000000,
              bandwidth: 100000000,
              managedClickhouseEvents: 1000000,
            },
            cdn: { lastUpdated: new Date(), status: "over" as const },
          });
        });

        it("should return UNLIMITED_USAGE getUsageFromCache for plans with unlimited usage", async () => {
          const usage = await getUsageFromCache(mockOrganization);
          expect(usage).toEqual(UNLIMITED_USAGE);

          // Since it is a pro account now, it should not refetch the data even in the background
          await backgroundUpdateUsageDataFromServerForTests;
          expect(mockedFetch).toHaveBeenCalledTimes(0);
        });
      });
    });

    describe("starter plan", () => {
      beforeEach(() => {
        (licenseUtil.getEffectiveAccountPlan as jest.Mock).mockReturnValue(
          "starter",
        );
      });

      it("should return UNLIMITED_USAGE if no usage data is available and license server errors", async () => {
        mockedFetch.mockRejectedValueOnce(new Error("Network error"));

        const usage = await getUsage(mockOrganization);

        expect(usage).toEqual(UNLIMITED_USAGE);
        expect(Sentry.captureException).toHaveBeenCalled();
        expect(mockedFetch).toHaveBeenCalledTimes(1);
      });

      it("should fetch usage data from the server if cache is empty and wait is true", async () => {
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usage = await getUsage(mockOrganization);
        expect(usage).toEqual(mockResponse[mockOrgId]);
        expect(mockedFetch).toHaveBeenCalledTimes(1);
      });

      it("should return cached usage data if available and not expired", async () => {
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usage = await getUsage(mockOrganization);
        const usage2 = await getUsage(mockOrganization);

        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(usage).toEqual(mockResponse[mockOrgId]);
        expect(usage2).toEqual(mockResponse[mockOrgId]);
      });

      it("should return cached usage data if available and expired, and refetch in the background", async () => {
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse2),
        } as unknown as Response);

        const usage = await getUsage(mockOrganization);
        expect(usage).toEqual(mockResponse[mockOrgId]);

        jest.setSystemTime(twoHoursFromNow);
        const usage2 = await getUsage(mockOrganization);
        expect(usage2).toEqual(mockResponse[mockOrgId]);

        // Once the background job is done
        await backgroundUpdateUsageDataFromServerForTests;
        expect(mockedFetch).toHaveBeenCalledTimes(2);

        // Following calls should return the new data
        const usage3 = await getUsage(mockOrganization);
        expect(usage3).toEqual(mockResponse2[mockOrgId]);
      });

      it("should not wait for the server response if getUsageFromCache is called, but subsequent request should have it", async () => {
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usage = getUsageFromCache(mockOrganization);
        expect(usage).toEqual(UNLIMITED_USAGE);

        await backgroundUpdateUsageDataFromServerForTests;
        expect(mockedFetch).toHaveBeenCalledTimes(1);

        const usage2 = getUsageFromCache(mockOrganization);
        expect(usage2).toEqual(mockResponse[mockOrgId]);
      });
    });
  });
});

describe("getUsages", () => {
  const env = process.env;
  const now = new Date("2023-11-21T12:08:12.610Z");
  const twoHoursAgo = new Date("2023-11-21T10:08:12.610Z");

  beforeEach(() => {
    resetUsageCache();
    jest.clearAllMocks();
    jest.useFakeTimers("modern");
    jest.setSystemTime(now);
    process.env = { ...env };
  });

  afterEach(() => {
    jest.useRealTimers();
    mockedFetch.mockReset();
    process.env = env;
  });

  describe("IS_CLOUD = false", () => {
    beforeEach(() => {
      isCloud = false;
    });

    it("should return UNLIMITED_USAGE for all organizations if not in cloud mode", async () => {
      const usages = await getUsages([mockOrganization, mockOrganization2]);

      expect(usages).toEqual({
        [mockOrgId]: UNLIMITED_USAGE,
        [mockOrgId2]: UNLIMITED_USAGE,
      });
      expect(mockedFetch).toHaveBeenCalledTimes(0);
    });

    it("should return UNLIMITED_USAGE for single organization if not in cloud mode", async () => {
      const usages = await getUsages([mockOrganization]);

      expect(usages).toEqual({
        [mockOrgId]: UNLIMITED_USAGE,
      });
      expect(mockedFetch).toHaveBeenCalledTimes(0);
    });

    it("should return empty object for empty organizations array", async () => {
      const usages = await getUsages([]);

      expect(usages).toEqual({});
      expect(mockedFetch).toHaveBeenCalledTimes(0);
    });
  });

  describe("IS_CLOUD = true", () => {
    beforeEach(() => {
      isCloud = true;
    });

    describe("pro plan", () => {
      beforeEach(() => {
        (licenseUtil.getEffectiveAccountPlan as jest.Mock).mockReturnValue(
          "pro",
        );
      });

      it("should return UNLIMITED_USAGE for all organizations with pro plans", async () => {
        const usages = await getUsages([mockOrganization, mockOrganization2]);

        expect(usages).toEqual({
          [mockOrgId]: UNLIMITED_USAGE,
          [mockOrgId2]: UNLIMITED_USAGE,
        });
        expect(mockedFetch).toHaveBeenCalledTimes(0);
      });

      describe("with existing usage data in cache from when organizations were free", () => {
        beforeEach(() => {
          setUsageInCache(mockOrgId, {
            limits: {
              requests: 10000000,
              bandwidth: 100000000,
              managedClickhouseEvents: 1000000,
            },
            cdn: { lastUpdated: new Date(), status: "over" as const },
          });
          setUsageInCache(mockOrgId2, {
            limits: {
              requests: 20000000,
              bandwidth: 200000000,
              managedClickhouseEvents: 2000000,
            },
            cdn: { lastUpdated: new Date(), status: "approaching" as const },
          });
        });

        it("should return UNLIMITED_USAGE for all organizations with pro plans regardless of cache", async () => {
          const usages = await getUsages([mockOrganization, mockOrganization2]);

          expect(usages).toEqual({
            [mockOrgId]: UNLIMITED_USAGE,
            [mockOrgId2]: UNLIMITED_USAGE,
          });
          expect(mockedFetch).toHaveBeenCalledTimes(0);
        });
      });
    });

    describe("starter plan", () => {
      beforeEach(() => {
        (licenseUtil.getEffectiveAccountPlan as jest.Mock).mockReturnValue(
          "starter",
        );
      });

      it("should return UNLIMITED_USAGE for all organizations if no usage data is available and license server errors", async () => {
        mockedFetch.mockRejectedValueOnce(new Error("Network error"));

        const usages = await getUsages([mockOrganization, mockOrganization2]);

        expect(usages).toEqual({
          [mockOrgId]: UNLIMITED_USAGE,
          [mockOrgId2]: UNLIMITED_USAGE,
        });
        expect(Sentry.captureException).toHaveBeenCalled();
        expect(mockedFetch).toHaveBeenCalledTimes(1);
      });

      it("should fetch usage data from the server for multiple organizations if cache is empty", async () => {
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockMultiOrgResponse),
        } as unknown as Response);

        const usages = await getUsages([mockOrganization, mockOrganization2]);

        expect(usages).toEqual({
          [mockOrgId]: mockMultiOrgResponse[mockOrgId],
          [mockOrgId2]: mockMultiOrgResponse[mockOrgId2],
        });
        expect(mockedFetch).toHaveBeenCalledTimes(1);
      });

      it("should return cached usage data for all organizations if available and not expired", async () => {
        // Pre-populate cache
        setUsageInCache(mockOrgId, mockMultiOrgResponse[mockOrgId]);
        setUsageInCache(mockOrgId2, mockMultiOrgResponse[mockOrgId2]);

        const usages = await getUsages([mockOrganization, mockOrganization2]);

        expect(usages).toEqual({
          [mockOrgId]: mockMultiOrgResponse[mockOrgId],
          [mockOrgId2]: mockMultiOrgResponse[mockOrgId2],
        });
        expect(mockedFetch).toHaveBeenCalledTimes(0);
      });

      it("should use cached data for some organizations and fetch for others", async () => {
        // Pre-populate cache for only one organization
        setUsageInCache(mockOrgId2, mockMultiOrgResponse[mockOrgId2]);

        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usages = await getUsages([mockOrganization, mockOrganization2]);

        expect(usages).toEqual({
          [mockOrgId]: mockResponse[mockOrgId],
          [mockOrgId2]: mockMultiOrgResponse[mockOrgId2],
        });
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(mockedFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining(mockOrgId),
          }),
        );
        // Ensure we don't fetch the cached organization
        expect(mockedFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.not.stringContaining(mockOrgId2),
          }),
        );
      });

      it("should handle mixed expired and valid cache data", async () => {
        // Set one organization with valid cache
        setUsageInCache(mockOrgId2, mockMultiOrgResponse[mockOrgId2]);

        // Set the other organization with expired cache
        jest.setSystemTime(twoHoursAgo);
        setUsageInCache(mockOrgId, mockMultiOrgResponse[mockOrgId]);
        jest.setSystemTime(now);

        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usages = await getUsages([mockOrganization, mockOrganization2]);

        expect(usages[mockOrgId2]).toEqual(mockMultiOrgResponse[mockOrgId2]);
        expect(usages[mockOrgId].limits.requests).toBe(
          mockResponse[mockOrgId].limits.requests,
        );
        expect(mockedFetch).toHaveBeenCalledTimes(1);
      });

      it("should handle empty organizations array", async () => {
        const usages = await getUsages([]);

        expect(usages).toEqual({});
        expect(mockedFetch).toHaveBeenCalledTimes(0);
      });

      it("should fallback to UNLIMITED_USAGE for organizations not returned by server", async () => {
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usages = await getUsages([mockOrganization, mockOrganization2]);

        expect(usages).toEqual({
          [mockOrgId]: mockResponse[mockOrgId],
          [mockOrgId2]: UNLIMITED_USAGE,
        });
        expect(mockedFetch).toHaveBeenCalledTimes(1);
      });
    });
  });
});
