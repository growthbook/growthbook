import fetch, { Response } from "node-fetch";
import * as Sentry from "@sentry/node";
import { OrganizationInterface } from "shared/types/organization";
import {
  backgroundUpdateUsageDataFromServerForTests,
  getUsage,
  getUsageFromCache,
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

const mockOrganization: OrganizationInterface = {
  id: "org_123",
  name: "Test Organization",
  dateCreated: new Date(),
  members: [],
  invites: [],
  url: "",
  ownerEmail: "",
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
          setUsageInCache(mockOrganization.id, {
            limits: { requests: 10000000, bandwidth: 100000000 },
            cdn: { lastUpdated: new Date(), status: "over" },
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
        const mockResponse = {
          limits: { requests: "1000", bandwidth: "10GB" },
          cdn: { lastUpdated: new Date(), status: "under" },
        };
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usage = await getUsage(mockOrganization);
        expect(usage).toEqual(mockResponse);
        expect(mockedFetch).toHaveBeenCalledTimes(1);
      });

      it("should return cached usage data if available and not expired", async () => {
        const mockResponse = {
          limits: { requests: "1000", bandwidth: "10GB" },
          cdn: { lastUpdated: new Date(), status: "under" },
        };
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usage = await getUsage(mockOrganization);
        const usage2 = await getUsage(mockOrganization);

        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(usage).toEqual(mockResponse);
        expect(usage2).toEqual(mockResponse);
      });

      it("should return cached usage data if available and expired, and refetch in the background", async () => {
        const mockResponse = {
          limits: { requests: "1000", bandwidth: "10GB" },
          cdn: { lastUpdated: new Date(), status: "under" },
        };
        const mockResponse2 = {
          limits: { requests: "2000", bandwidth: "20GB" },
          cdn: { lastUpdated: new Date(), status: "over" },
        };
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse2),
        } as unknown as Response);

        const usage = await getUsage(mockOrganization);
        expect(usage).toEqual(mockResponse);

        jest.setSystemTime(twoHoursFromNow);
        const usage2 = await getUsage(mockOrganization);
        expect(usage2).toEqual(mockResponse);

        // Once the background job is done
        await backgroundUpdateUsageDataFromServerForTests;
        expect(mockedFetch).toHaveBeenCalledTimes(2);

        // Following calls should return the new data
        const usage3 = await getUsage(mockOrganization);
        expect(usage3).toEqual(mockResponse2);
      });

      it("should not wait for the server response if getUsageFromCache is called, but subsequent request should have it", async () => {
        const mockResponse = {
          limits: { requests: "1000", bandwidth: "10GB" },
          cdn: { lastUpdated: new Date(), status: "under" },
        };
        mockedFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        } as unknown as Response);

        const usage = await getUsageFromCache(mockOrganization);
        expect(usage).toEqual(UNLIMITED_USAGE);

        await backgroundUpdateUsageDataFromServerForTests;
        expect(mockedFetch).toHaveBeenCalledTimes(1);

        const usage2 = await getUsageFromCache(mockOrganization);
        expect(usage2).toEqual(mockResponse);
      });
    });
  });
});
