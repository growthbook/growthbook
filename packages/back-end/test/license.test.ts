import fetch, { Response } from "node-fetch";

import cloneDeep from "lodash/cloneDeep";
import { LicenseInterface } from "shared/enterprise";
import {
  LICENSE_SERVER_URL,
  licenseInit,
  getLicense,
  resetInMemoryLicenseCache,
  getLicenseError,
  backgroundUpdateLicenseFromServerForTests,
} from "back-end/src/enterprise/licenseUtil";
import * as LicenseModelModule from "back-end/src/enterprise/models/licenseModel";

const LicenseModel = LicenseModelModule.LicenseModel;

jest.mock("node-fetch");
jest.mock("../src/enterprise/models/licenseModel");

const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe("src/license", () => {
  const env = process.env;
  const userLicenseCodes = {
    fullMembers: ["code1", "code2"],
    readOnlyMembers: [],
    invites: [],
  };
  const metaData = {
    installationId: "installation-04ed35f0-806c-4ecb-b148-051bc42dd3e1",
    gitSha: "gitSha",
    gitCommitDate: "2023-01-01",
    sdkLanguages: ["node"],
    dataSourceTypes: ["postgres"],
    eventTrackers: ["rudderstack"],
    isCloud: false,
  };
  const getUserCodesForOrg = () => Promise.resolve(userLicenseCodes);
  const getLicenseMetaData = () => Promise.resolve(metaData);
  const licenseKey = "license_19exntswvlosvp1d6";
  const org = { id: "org_id", licenseKey };
  const licenseData = {
    id: "license_19exntswvlosvp1d6",
    companyName: "Acme",
    organizationId: "",
    seats: 1,
    isTrial: true,
    plan: "starter",
    emailVerified: true,
    remoteDowngrade: false,
    archived: false,
    hardCap: false,
    name: "",
    email: "",
    usingMongoCache: false,
    dateCreated: "2023-11-10T17:15:11.274Z",
    dateExpires: "2024-10-23T00:00:00.000Z",
    dateUpdated: "2023-11-21T12:08:12.610Z",
    seatsInUse: 1,
    installationUsers: {
      "installation-04ed35f0-806c-4ecb-b148-051bc42dd3e1": {
        date: "2023-11-17T19:48:38.562Z",
        userHashes: ["6ef56f32"],
        licenseUserCodes: {
          fullMembers: ["6ef56f32"],
          readOnlyMembers: [],
          invites: [],
        },
      },
    },
    signedChecksum:
      "ceT1mfCsWyyRE3B1CaaK6bXF5zUIXPIM1bASRRftDLLnFwGAjp8bAxGERzqVPeTLjy9eOAvC3nkpQhcb29jNJSy0f7d-6InMYsRPXln3fQ-EpZpxQOhoaPv2-cElier0wXmUM8jFI7FGAMZ-uugxhM4ofvoeIwrLghTHeelILNcUBiGk4AYCQrwZquTK9BXPyPCaBFrGhqM0RRZzHTpimEMS9TcmR90rrHEtXTagPVp_gEP508J1IYaVsymEt9N6Dp5Wk7ohb8XtODURsxiDJmrcqEQODvyabrNetSo3qVXsJ-qd4x6Imr79RfjLeR82lByZNqfH9r1V3omARlinDmq1VHoA3cRzA98iwcQBND1MWFZa5wikMkgQxxGqixQE6PCqAtfooBLdb_kqe_wHz3pU4qjVSw10_VjEiqlxXBLuYn20FgKMcpI5qwTUQiS0gJomkY2Nq5GQjXm-040VEgn6TqhRDQAlv4yWMBO6NaSVYQmwMjRhXLQ9mOYX6vugQMbpIO7NjvGWGoD8d_KoHZL0sriKJlVsYn3iFiIEkZIzD3mBwtMh2YCrPvX4OTCm4CSrWoEvaprx4JfFI4mgD5-XUBG_lBjb74hiLA7NdV8c3zD47BTu187PwC2-GC1Y521Y_IU8eMqW7bGJYnuSroNV7C8ccU4rRMPY9asRN0E",
  } as LicenseInterface;
  const licenseData2 = cloneDeep(licenseData);
  licenseData2.seatsInUse = 2;
  licenseData2.signedChecksum =
    "Agiu1qpYlPE5BzpLfiA7V9fCCrW-0_jqQYel-ok7TRAh5jP0F_BbXZOeNCcOz1RvRZ6wKrcznwbD0P9QXO-WfJuS9kQ_B4m5ljvlb57mTufq9YtroBJlNwJNKPbXFcjxXJxXNP1Vu3nJr2lSLiXAGaVXDZwVCCiTvksPQx5wIB1acyGCp-AuHp-Zj-3gGxYNZxG49fxIkZwvYCCbro95dAUcRngjU30H1hKzyPry3Fxuhl06mGVnG74xYOdzZmsx65TS4U-cHs9mI-tzL_nTxxIrWi3lX0_-KZVghLZqjXw9pzeWeQaUY8IukJ7hB4pPnOESvmIZkAKzMApoo7bwjt-ndeBbE9LAyyfA0Ha9KH4vd6zP5ZPvKXINw8DEfk67npUZIvH6GNAsSyMR0zOhNnyt9g81M-UJMJ96-OJMd_5H9--wHPGp6JXqJGIoqL-bvZiXbJhC-5heO2Ux0Dd-sOCdzvgmDd0hOqPa36lUUrZTidvbzJQ17pg66yO3kj4urxSSHZcPNKe3wc3cIcw9gU5wF_eJSsuyC2_PGBIizJdg1cEK25yGAj_vo24fCghcwNWtlCI3Tlv98j1Bn6lsALnafDfrQevHJeJPTcDE_0w_d_Ng77wPFqC_uiJlJxk0RI_08l7FuyWOJtRNMGR-xQRth45OKncxYwCeu-jHTzo";

  const oldLicenseKey =
    "eyJyZWYiOiIyNDAzMjEiLCJzdWIiOiJBY21lIiwib3JnIjoib3JnXzEyMyIsInF0eSI6MywiaWF0IjoiMjAyMy0xMS0xOCIsImV4cCI6IjIwMjMtMTEtMTkiLCJ0cmlhbCI6dHJ1ZSwicGxhbiI6InBybyJ9.Wf_rdgs4Ice1aFImF9bFBVeyP3gfo1V9CyNh9U5kJguKvzpLJEDE7x1bU4zsenaY-sBBv_IeD5UrCf-7ktcW9AQBuQa_c8IK96Dq57gCDGJ5fmTpqL8jZJF9d0HJd-uDhbXqNXway7a3MLK7lwo9BxD4ZiANafrn9qKH0tB30gUChCm61h9trxDmcWIGYi9HFtICvqkKLXthgKgQYV7pHhnB3BzhUXu6p2iDURSIQhergUv3y833tjJ-I_rtMxpeKumJOHAqQDPF3hlNzL4y6WIVAp0RyDEYD3PyfQVsJpY5QRK2cZEwWJr_JRFOmou5O79oZjyAPsbjw2J-41BsNGnshA00MS6l74Aae1zFES10zwxo0En8TS5CqrwIW05hSs1pp-UKM56RFsPTjayGmiGdUSGf7vMo4e7RtE73T9RIntbfqTXYg2FTPiergiYr7gVBPi-JNiicwKOxGChoaIwVkha8Pp3B9yUfTyjWNEm0S9xTlv3l8dRmla2_62YAU3hlvQqZQvRXciOrMPyBQnPuQq9srRSFi2kFYMefgXCSTnFSi9pz9uOiJix7REYlEVOq_qujoRVYHY2h7zZwsIBiR_jCZTX8gJXxPDSDseiWzgXY11YZNWuNC551cRrBurNP1M_M_Z6-A7IXyfrhzBJizYw6a81R6NBBulCVDLc";

  const oldLicenseOrginalData = {
    ref: "240321",
    sub: "Acme",
    org: "org_123",
    qty: 3,
    hardCap: false,
    trial: true,
    iat: "2023-11-18",
    exp: "2023-11-19",
    plan: "pro",
  };

  const oldLicenseData = {
    id: "240321",
    companyName: "Acme",
    organizationId: "org_123",
    seats: 3,
    hardCap: false,
    isTrial: true,
    dateCreated: "2023-11-18",
    dateExpires: "2023-11-19",
    plan: "pro",
  };

  const now = new Date("2023-11-21T12:08:12.610Z");
  const old_license_now = new Date(Date.UTC(2023, 10, 18, 18, 45, 4, 713));

  beforeEach(() => {
    jest.resetModules();
    resetInMemoryLicenseCache();
    jest.clearAllMocks();
    jest.useFakeTimers("modern");
    jest.setSystemTime(now);
    process.env = { ...env };
  });

  afterEach(() => {
    jest.spyOn(JSON, "parse").mockRestore();
    jest.spyOn(LicenseModelModule, "getLicenseByKey").mockRestore();
    jest.useRealTimers();
    mockedFetch.mockReset();
    process.env = env;
  });

  it("should not be calling localhost for the license server", async () => {
    expect(LICENSE_SERVER_URL).not.toContain("localhost");
  });

  describe("getLicenseError", () => {
    const org = { id: "org_id", licenseKey };

    describe("when there is no license", () => {
      it("should throw an error if SSO is enabled and IS_CLOUD is false", () => {
        process.env.SSO_CONFIG = "true";

        expect.assertions(1);

        expect(() => {
          getLicenseError(org);
        }).toThrowError(
          "You need an enterprise license for SSO functionality. Either upgrade to enterprise or remove SSO_CONFIG environment variable.",
        );
      });

      it("should not throw an error if SSO is enabled on cloud no matter what", () => {
        process.env.SSO_CONFIG = "true";
        process.env.IS_CLOUD = "true";

        expect(getLicenseError(org)).toBe("");
      });

      it("should return multi org error if the env var is set", () => {
        process.env.IS_MULTI_ORG = "true";

        expect.assertions(1);

        expect(() => {
          getLicenseError(org);
        }).toThrowError(
          "You need an enterprise license for multi-org functionality. Either upgrade to enterprise or remove IS_MULTI_ORG environment variable.",
        );
      });

      it("should not throw an error if multi-org is enabled on cloud", () => {
        process.env.IS_MULTI_ORG = "true";
        process.env.IS_CLOUD = "true";

        expect(getLicenseError(org)).toBe("");
      });

      it("should not have an error if there is no license and no enterprise env vars set", () => {
        expect(getLicenseError(org)).toBe("");
      });
    });

    describe("when there is a license but it has no plan and no server error", () => {
      const licenseDataNoPlan = cloneDeep(licenseData);
      delete licenseDataNoPlan.plan;
      licenseDataNoPlan.remoteDowngrade = true; // This would cause the function to return an error, if there was a plan
      licenseDataNoPlan.signedChecksum =
        "XFbpDLvayp71avE47pYNPTW5MKQWl1qqhTo6Cm4mEj5ipejjhnpfoPmInxwKFK0xjnpNkGnr25NW_d0XthgotnZPKV7KMzSZ6DRe7fIRRaTP6H10e3iashAsuRX_KNlHsZgaPdbxSWYw0_vQE9bxJVLTINPog7HEf-ZQONZ6Wod4vUf91MRu8d8NK6LVp9e1OVY7HOm-klKWfrE-3jx3aloDnfGq17B0uU0NbvRfj2FyxL-vkAgUPXmRUk64RnCB2mRqkFspT1Rm-kTvRsJxbWw_sA4ZPeSGYA7SPyUl-roUlD-g-CXUwLoLOdJB2WusAu9E2EXyy9w-d9E6N1nBtEGim2X2JKXTe2aN6BMmPK6jtWFa1D1iAO4lyjxbbaH8oNZlNtb9D78c6rdrLZuWfoAgoRXEINTAIBYo0wBFLb8Wu5f0dNUvkRXdDg8RQvtaXJ0VfGwZ4cw9SVeRElwME9m4Kc8CTqKbk0HG41sDlY3ACWJalxh7xWEzH0u_LXIfllV5Sq-7YDGtGnykwXBHl7m_rQ3qi5bX7WHYBu1hdMf3gIiUwKln9U3eW4nT7D8GJlSE1kj9_6n57KhkvkqoLBsqGhncsE2C8rkdUQYB9xlja_H6k0mupNCxEnciZiRftJpLSznzyV4AdLGgiX78l1gU-Iwy28XOaMeo5Ess8W8";

      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseDataNoPlan),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should throw an error if SSO is enabled and IS_CLOUD is false", () => {
        process.env.SSO_CONFIG = "true";

        expect.assertions(1);

        expect(() => {
          getLicenseError(org);
        }).toThrowError(
          "You need an enterprise license for SSO functionality. Either upgrade to enterprise or remove SSO_CONFIG environment variable.",
        );
      });

      it("should not throw an error if SSO is enabled on cloud no matter what", () => {
        process.env.SSO_CONFIG = "true";
        process.env.IS_CLOUD = "true";

        expect(getLicenseError(org)).toBe("");
      });

      it("should return multi org error if the env var is set", () => {
        process.env.IS_MULTI_ORG = "true";

        expect.assertions(1);

        expect(() => {
          getLicenseError(org);
        }).toThrowError(
          "You need an enterprise license for multi-org functionality. Either upgrade to enterprise or remove IS_MULTI_ORG environment variable.",
        );
      });

      it("should not throw an error if multi-org is enabled on cloud", () => {
        process.env.IS_MULTI_ORG = "true";
        process.env.IS_CLOUD = "true";

        expect(getLicenseError(org)).toBe("");
      });

      it("should not have an error since no plan means it was an abandoned stripe checkout and not a full license", () => {
        expect(getLicenseError(org)).toBe("");
      });
    });

    describe("when there is a license but it has no plan but has a server error", () => {
      const licenseDataNoPlan = {
        ...cloneDeep(licenseData),
        plan: "",
        lastServerErrorMessage: "Server error",
        signedChecksum:
          "KmcsuAwjrSNRe-9fdBxL9e33D3dmkTaU9YH2d4KqnBS87IK_bDEXEEQFOR2fovHZS0FJ6r4OrbcncDGlv2BiO7s78M3BepEyBwCeVQJ5hMTCtEhvGgkbODf0aPJmUHhxthvAk-jMUljsgHKaftR9ocYBkzuFCl12vxAHAJ3q28YAk4OmOHV6Wak0N_PF_B1qkK2VUa80gAS0HDU0qiwZXcXusbN7GMe2n3sEh_M261-i0UBTwfEBM_tI1xoWKWkdjbyAtitMBxMk4llx6A_bnb3mno35s_lhQBbevQAj-Gcc91sJh5BGNBOrssieByU1CePXpnG3VKvjCKl-jFm68b-N-s2D6kWazhg0Q5mUDjCfZQI35Ma4iiQGIqVV0kSxrstTHjKUGZJkbyum9Mmu4GahuqOrVLys_e1ialotrKsRgnvM4UKzfx0sabwXdo17fKVCZDqEciU1Wl8oqSZiENydbKasjxjcDk3esB_PX-ZLH9D-YYb7qiKwh19PEx1kbdCuxuDwwWfji2tzVLsgIuySjETu3oOZyfFEwJkPaNQUUPm5DGRhgq4Q0X_455n09K6HnMPAj4YJfT4-4PyTxJrbCGUzh-kRxN63xr8AdT3jQpoije8MClE-xt-LR8LFh40x31DoNXjPRw8RkABmwcHnNFaUfR-_OQhtnEZ771U",
      };
      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseDataNoPlan),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should have an error since no plan but an error means the license server errored or could not connect on first ever try", () => {
        expect(getLicenseError(org)).toBe(
          "License server erroring for too long",
        );
      });
    });

    describe("when there is a license but it has no plan but has a server error", () => {
      const licenseDataNoPlan = {
        ...cloneDeep(licenseData),
        plan: "",
        lastServerErrorMessage: "Could not connect to server",
        signedChecksum:
          "KmcsuAwjrSNRe-9fdBxL9e33D3dmkTaU9YH2d4KqnBS87IK_bDEXEEQFOR2fovHZS0FJ6r4OrbcncDGlv2BiO7s78M3BepEyBwCeVQJ5hMTCtEhvGgkbODf0aPJmUHhxthvAk-jMUljsgHKaftR9ocYBkzuFCl12vxAHAJ3q28YAk4OmOHV6Wak0N_PF_B1qkK2VUa80gAS0HDU0qiwZXcXusbN7GMe2n3sEh_M261-i0UBTwfEBM_tI1xoWKWkdjbyAtitMBxMk4llx6A_bnb3mno35s_lhQBbevQAj-Gcc91sJh5BGNBOrssieByU1CePXpnG3VKvjCKl-jFm68b-N-s2D6kWazhg0Q5mUDjCfZQI35Ma4iiQGIqVV0kSxrstTHjKUGZJkbyum9Mmu4GahuqOrVLys_e1ialotrKsRgnvM4UKzfx0sabwXdo17fKVCZDqEciU1Wl8oqSZiENydbKasjxjcDk3esB_PX-ZLH9D-YYb7qiKwh19PEx1kbdCuxuDwwWfji2tzVLsgIuySjETu3oOZyfFEwJkPaNQUUPm5DGRhgq4Q0X_455n09K6HnMPAj4YJfT4-4PyTxJrbCGUzh-kRxN63xr8AdT3jQpoije8MClE-xt-LR8LFh40x31DoNXjPRw8RkABmwcHnNFaUfR-_OQhtnEZ771U",
      };
      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseDataNoPlan),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should have an error since no plan but an error means the license server errored or could not connect on first ever try", () => {
        expect(getLicenseError(org)).toBe(
          "License server unreachable for too long",
        );
      });
    });

    describe("when there is a license, and it is using cache but it is way too out of date", () => {
      const licenseDataTooOld = {
        ...cloneDeep(licenseData),
        usingMongoCache: true,
        dateUpdated: new Date(
          now.getTime() - 15 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      };

      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseDataTooOld),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should return an error saying the server is down too long", () => {
        expect(getLicenseError(org)).toBe(
          "License server unreachable for too long",
        );
      });
    });

    describe("when there is a license, and it is using cache and it is out of date, but it is less than 7 days since the first failed fetch", () => {
      const licenseDataTooOld = {
        ...cloneDeep(licenseData),
        usingMongoCache: true,
        firstFailedFetchDate: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
        dateUpdated: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
      };

      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseDataTooOld),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should still use cache (but we will show a warning)", () => {
        expect(getLicenseError(org)).toBe("");
      });
    });

    describe("when there is a license, and it is using cache and it is out of date, but it is erroring more than 7 days since the first failed fetch", () => {
      const licenseDataTooOld = {
        ...cloneDeep(licenseData),
        usingMongoCache: true,
        firstFailedFetchDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        lastServerErrorMessage: "Server error",
        dateUpdated: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
      };

      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseDataTooOld),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should return an error saying the server is down too long", () => {
        expect(getLicenseError(org)).toBe(
          "License server erroring for too long",
        );
      });
    });

    describe("when there is a license, and it is using cache and it is out of date, but it is unreachable for more than 7 days since the first failed fetch", () => {
      const licenseDataTooOld = {
        ...cloneDeep(licenseData),
        usingMongoCache: true,
        firstFailedFetchDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        lastServerErrorMessage: "Could not connect to server",
        dateUpdated: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
      };

      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseDataTooOld),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should return an error saying the server is down too long", () => {
        expect(getLicenseError(org)).toBe(
          "License server unreachable for too long",
        );
      });
    });

    describe("when there is a license but has expired", () => {
      const expiredLicense = cloneDeep(licenseData);
      expiredLicense.dateExpires = new Date(
        now.getTime() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString();
      expiredLicense.signedChecksum =
        "dmFmZdVbiR3Ed-s9lyHys2hqmu_fMYMS7EreU4g6FKipPatQL-dsrC-vvUo3DYhEWZzC72T5mPoRcsUWPUWNp_wtpuYnozDbLCVs4nzbr0yQJ32eSFlO3qvTkzElVWCipILDKHKmzs6JXUSerljxOAI0TtXxkXkWMdTuOvxEwwO0KMTazz9c-rLg4P4iuFhSvZmnE82kecLvf0ZeRImQuW_8Ts7dT1L-5uzVH0eQjz2S0e3xdwYFE5F0vBufxkizg-68RG_AFmJ8sqO53Ys316Q3S2dwNFlA-dmAGc3TVJKis9D-TZCkHENuSdKfbj4nKwql3Uye8Vj9LxMHI2Vps-R6RXr2f-r2IKk6aqqUGl9A3p2FFvrf1QhFrmyQBKOeyvRI_tojd0F7rh4-FptLV8_Z46KUblGSSdhjg79JZV-KpH4h_uH0HwVtyFoi-deI4A-4cRynYJEu2IWvDCc5XJr6tspC_tuNX37D_Nw17uxC1Gy9a7vk832zkUdQlwOtzt2GV23QUSSOYFjSkOgoCAybbcWNSeZuaE3sEsso_Gwq9aqPrN1FlcNuyIVlmXWJt-0rI9uUD5hmpcTeH01m3AmNOu8es4yjTz1JmJY3TTQ4JgZqRyMvasxgZcEUCF_4p9Qn58l1kWo4AHkvlbHAHEHovwPX1YdiacBux82ORIk";
      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(expiredLicense),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should return an error if the license is too old", () => {
        expect(getLicenseError(org)).toBe("License expired");
      });
    });

    describe("when there is a license but the email is not verified", () => {
      const licenseWithUnverifiedEmail = cloneDeep(licenseData);
      licenseWithUnverifiedEmail.emailVerified = false;
      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseWithUnverifiedEmail),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
        await licenseInit({ id: org.id, licenseKey: oldLicenseKey });
      });

      it("should return an error saying the email is not verified", () => {
        expect(getLicenseError(org)).toBe("Email not verified");
      });

      it("should not throw an error if it is an old syle license", () => {
        jest.setSystemTime(old_license_now);
        const org_with_old_style_license = {
          id: "org_123",
          licenseKey: oldLicenseKey,
        };
        expect(getLicenseError(org_with_old_style_license)).toBe("");
      });

      it("should not throw an error if it is an old syle license in the env var", () => {
        jest.setSystemTime(old_license_now);
        process.env.LICENSE_KEY = oldLicenseKey;
        const org_with_old_style_license = {
          id: "org_123",
        };
        expect(getLicenseError(org_with_old_style_license)).toBe("");
      });
    });

    describe("when there is a license but the org does not match", () => {
      const licenseWithWrongOrg = cloneDeep(licenseData);
      licenseWithWrongOrg.organizationId = "org_wrong";
      licenseWithWrongOrg.signedChecksum =
        "TKz09mcJa0411s0VYJEJ5-nkmJY13LIQapY4-t1-4C9CbK4m4FTzGlLC4kee163bqisRcinfq10TLXgUHTYaPW2WbUfMIz57iVhN5QoXpGBVGVNIqBHS4jiVvrLfUoV_Ms-9GBvvYb-KfxkkPqizn5bE27BrIpasVXJg8RbYfN7rNc3cYPTD5rKhZaIyeDjyHtff1_M9GVTHRV1-F9_mzoE1znZ_ln0-JRWtAaISeY6gzXOW84LcQusx_O--7i_1hJxQlnsJ6qZ1XTcCbmfgWi3wbYI1815BU9UvnMC1qcLh3ALpN918NXhyMMeLEql6W71ftZaM4i_LLjKPzXb39bC9okc1tVoisGs2burhWK0DxVM6TWcv7QDd2q9u48bv3bIIxJ1Aw94ob6DHOmr3klFk9_5mwFPTzx4Y34uVX0gUgCo0ndPi5RLf3NHAm8f6OZ-h-9hrSEv_uqwfBWaSlmc7193lBzKssvbvDYHLLWnqI0iRs4usHPlyttqVSyHwTBF2omqGsx5ggvujT2e1wFsQTjWDBGzAG37ruJglCGFrozHiDhT-NyOtRTxjFcMJr13CevQ8BPiyKtQE_lguvbw-eB6BZsXDxsMXzwi1sxc31xJ4e0kpJdwUvn5G_XKKCcgYugHzDZieeuzYDoWF3ITr3eFnXuVp6cYsK5xRpU8";

      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseWithWrongOrg),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should return an error that the license is invalid", () => {
        expect(getLicenseError(org)).toBe("Invalid license");
      });
    });

    describe("when there is a license but it has been remotely downgraded", () => {
      const licenseWithWrongOrg = cloneDeep(licenseData);
      licenseWithWrongOrg.remoteDowngrade = true;
      licenseWithWrongOrg.signedChecksum =
        "QZ3S5mm_sCcUA5z1zIJdRpveNkmwKzf15zlFf_8sMqflKsWpzKw9R1-xUItQ8l6AXdgA5_ohdBglfTvNu4efkS8DdT3oavN0o2XVx_ZmIUkSWyudmqv6HOFba6r9vidaQ6Qhyvu7vVIL2RwLnOlFTaud1pD0OZolKW8iut1PV9QSo1upUO50DTbJ3PGZQcDBNUN8EfExcG7K-gfeaRYud9LFVKU0kd_xM4hg9XhgCQuEvtfblbXB56uFRm9Gbm9KdlV6APZFmOm8DTqkUqvJCdV3ySuEmmAqLW2K6unQRQBJy7pYFV0rXhSYVB6DtmUPlq4k-8BwCvYGO5DDZpsj3k0pGW5BIE90QrdgnqbuB8xXTnAm5YwVCAv0fWxjoRi00RhjKDpEEgwNxX2qzYDQMU5SbUJLJcWRoijyWrmOOzBPfvUxg8FiU_hIVAAmPYO3JxYgBrleaetYZu7hcSPYIOk7It1OWYCuVfFfHiYtwvBc_--Bg4rUitGZu7OxSJYvTPC3THJmc8_UgXNe9hImMLRvA4y-BdZrDXRDPhZSKPuymla8yMFEM0FoXdm6PBlTK2f5tCkyduQptxTibk9pQ8GBkeDmvM0qTfJp3So8OnriYowJyqQL8rSo__oVzyp5TZ5cQAsj0HvQXe5W9aqgd4VJFrvlk7tGPKFKUp4aq6E";

      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseWithWrongOrg),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should return an error that the license is invalid", () => {
        expect(getLicenseError(org)).toBe("License invalidated");
      });
    });

    describe("when there is a valid license on the org", () => {
      beforeEach(async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
        await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      });

      it("should not have an error if the license is valid", () => {
        expect(getLicenseError(org)).toBe("");
      });

      it("should throw an error if SSO is enabled but the license does not support it", () => {
        process.env.SSO_CONFIG = "true";

        expect.assertions(1);

        expect(() => {
          getLicenseError(org);
        }).toThrowError(
          "You need an enterprise license for SSO functionality. Either upgrade to enterprise or remove SSO_CONFIG environment variable.",
        );
      });

      it("should not throw an error if SSO is enabled on cloud even if the license does not support it", () => {
        process.env.SSO_CONFIG = "true";
        process.env.IS_CLOUD = "true";

        expect(getLicenseError(org)).toBe("");
      });

      it("should return multi org error if the license does not support multi org", () => {
        process.env.IS_MULTI_ORG = "true";

        expect.assertions(1);

        expect(() => {
          getLicenseError(org);
        }).toThrowError(
          "You need an enterprise license for multi-org functionality. Either upgrade to enterprise or remove IS_MULTI_ORG environment variable.",
        );
      });

      it("should not throw an error if multi-org is enabled on cloud even if the license does not support it", () => {
        process.env.IS_MULTI_ORG = "true";
        process.env.IS_CLOUD = "true";

        expect(getLicenseError(org)).toBe("");
      });
    });
  });

  describe("licenseInit and getLicense", () => {
    it("should set licenseData to null if licenseKey is not provided", async () => {
      const result = await licenseInit(
        { id: org.id },
        getUserCodesForOrg,
        getLicenseMetaData,
      );

      expect(result).toBeUndefined();
      expect(getLicense()).toBeNull();
    });

    describe("new style licenses where licenseKey starts with 'license_'", () => {
      describe("and when the license server is up", () => {
        beforeEach(() => {
          const mockedResponse: Response = {
            ok: true,
            json: jest.fn().mockResolvedValueOnce(licenseData),
          } as unknown as Response;

          mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));

          jest
            .spyOn(LicenseModelModule, "getLicenseByKey")
            .mockResolvedValueOnce(null);
        });

        it("should use the env variable if licenseKey argument is not provided", async () => {
          process.env.LICENSE_KEY = licenseKey;
          const result = await licenseInit(
            { id: org.id },
            getUserCodesForOrg,
            getLicenseMetaData,
          );

          expect(getLicense()).toEqual(licenseData);
          expect(result).toEqual(licenseData);
        });

        it("should throw an error if we call the function without getUserCodesForOrg, or getLicenseMetaData", async () => {
          expect.assertions(2);

          await expect(
            licenseInit(org, undefined, getLicenseMetaData),
          ).rejects.toThrowError(
            "Missing org, getUserCodesForOrg, or getLicenseMetaData for connected license key",
          );

          await expect(
            licenseInit(org, getUserCodesForOrg, undefined),
          ).rejects.toThrowError(
            "Missing org, getUserCodesForOrg, or getLicenseMetaData for connected license key",
          );
        });

        it("should call fetch once and the second time return in-memory cached license data if it exists and is not too old", async () => {
          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

          expect(fetch).toHaveBeenCalledWith(
            `${LICENSE_SERVER_URL}license/${licenseKey}/check`,
            expect.objectContaining({
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "GrowthBook",
              },
              body: JSON.stringify({
                licenseUserCodes: userLicenseCodes,
                metaData,
              }),
            }),
          );

          expect(getLicense(licenseKey)).toEqual(licenseData);

          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
          expect(getLicense(licenseKey)).toEqual(licenseData);
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(LicenseModel.findOneAndReplace).toHaveBeenCalledTimes(1);
          expect(LicenseModel.findOneAndReplace).toHaveBeenCalledWith(
            { id: licenseKey },
            licenseData,
            { upsert: true },
          );
          expect(LicenseModelModule.getLicenseByKey).toHaveBeenCalledTimes(2);
        });

        it("should fetch the license from datastore if it is not in memory", async () => {
          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

          expect(fetch).toHaveBeenCalledWith(
            `${LICENSE_SERVER_URL}license/${licenseKey}/check`,
            expect.objectContaining({
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "GrowthBook",
              },
              body: JSON.stringify({
                licenseUserCodes: userLicenseCodes,
                metaData,
              }),
            }),
          );

          expect(getLicense(licenseKey)).toEqual(licenseData);
          resetInMemoryLicenseCache();
          jest
            .spyOn(LicenseModelModule, "getLicenseByKey")
            .mockResolvedValue(cloneDeep(licenseData));
          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

          expect(getLicense(licenseKey)).toEqual({
            ...licenseData,
            usingMongoCache: true,
          });
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(LicenseModel.findOneAndReplace).toHaveBeenCalledTimes(1);
          expect(LicenseModel.findOneAndReplace).toHaveBeenCalledWith(
            { id: licenseKey },
            licenseData,
            { upsert: true },
          );
          expect(LicenseModelModule.getLicenseByKey).toHaveBeenCalledTimes(3);
        });

        it("should fetch the license from the license server if the license is not in memory and the datastore is too old", async () => {
          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

          expect(fetch).toHaveBeenCalledWith(
            `${LICENSE_SERVER_URL}license/${licenseKey}/check`,
            expect.objectContaining({
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "GrowthBook",
              },
              body: JSON.stringify({
                licenseUserCodes: userLicenseCodes,
                metaData,
              }),
            }),
          );

          expect(getLicense(licenseKey)).toEqual(licenseData);

          jest.spyOn(LicenseModel, "findOne").mockResolvedValue({
            ...licenseData,
            toJSON: () => licenseData,
            save: jest.fn(),
            set: jest.fn(),
          });

          const twoDaysFromNow = now.getTime() + 8 * 24 * 60 * 60 * 1000;
          jest.setSystemTime(twoDaysFromNow);

          const mockedResponse2: Response = {
            ok: true,
            json: jest.fn().mockResolvedValueOnce(licenseData2),
          } as unknown as Response; // Create a mock Response object

          mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse2));

          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
          expect(getLicense(licenseKey)).toEqual(licenseData2);
          expect(fetch).toHaveBeenCalledTimes(2);
        });

        it("should call fetch once for each key when called with multiple keys simultaneously, and getLicense should return correct licenseData for each key", async () => {
          mockedFetch.mockReset(); // this test is different from the others

          const mockedResponse: Response = {
            ok: true,
            json: jest.fn().mockResolvedValueOnce(licenseData),
          } as unknown as Response;

          const licenseKey2 = "license_19exntswvlosvp1dasdfads";
          const licenseData3 = cloneDeep(licenseData2);
          licenseData3.id = licenseKey2;

          const mockedResponse2: Response = {
            ok: true,
            json: jest.fn().mockResolvedValueOnce(licenseData3),
          } as unknown as Response;

          mockedFetch.mockImplementation((url) => {
            const urlString = String(url);
            if (urlString.includes(licenseKey)) {
              return Promise.resolve(mockedResponse);
            } else if (urlString.includes(licenseKey2)) {
              return Promise.resolve(mockedResponse2);
            }
            return Promise.reject({} as Response);
          });

          // Number of concurrent requests
          const numRequests = 10;

          // Execute multiple concurrent requests
          const results = await Promise.all(
            Array.from({ length: numRequests }).map(async (_, i) => {
              if (i % 2 === 0) {
                return await licenseInit(
                  org,
                  getUserCodesForOrg,
                  getLicenseMetaData,
                );
              } else {
                return await licenseInit(
                  { id: org.id, licenseKey: licenseKey2 },
                  getUserCodesForOrg,
                  getLicenseMetaData,
                );
              }
            }),
          );

          expect(fetch).toHaveBeenCalledTimes(2);

          expect(results[0]).toEqual(licenseData);
          expect(results[1]).toEqual(licenseData3);
          expect(
            results.every((result, i) =>
              i % 2 === 0 ? result === licenseData : result === licenseData3,
            ),
          ).toBe(true);

          expect(getLicense(licenseKey)).toEqual(licenseData);
          expect(getLicense(licenseKey2)).toEqual(licenseData3);
        });

        it("should call fetch twice rather than use the in-memory cache if it has been over a day since the last fetch, and update the licenseData", async () => {
          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

          expect(fetch).toHaveBeenCalledWith(
            `${LICENSE_SERVER_URL}license/${licenseKey}/check`,
            expect.objectContaining({
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "GrowthBook",
              },
              body: JSON.stringify({
                licenseUserCodes: userLicenseCodes,
                metaData,
              }),
            }),
          );

          expect(getLicense(licenseKey)).toEqual(licenseData);
          const tenDaysFromNow = now.getTime() + 10 * 24 * 60 * 60 * 1000;
          jest.setSystemTime(tenDaysFromNow);

          const mockedResponse2: Response = {
            ok: true,
            json: jest.fn().mockResolvedValueOnce(licenseData2),
          } as unknown as Response; // Create a mock Response object

          mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse2));

          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
          expect(getLicense(licenseKey)).toEqual(licenseData2);
          expect(fetch).toHaveBeenCalledTimes(2);
        });

        it("should call fetch twice rather than use the in-memory cache if forceRefresh flag is true", async () => {
          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

          expect(getLicense(licenseKey)).toEqual(licenseData);

          const mockedResponse2: Response = {
            ok: true,
            json: jest.fn().mockResolvedValueOnce(licenseData2),
          } as unknown as Response; // Create a mock Response object

          jest.spyOn(LicenseModel, "findOne").mockResolvedValue({
            ...licenseData,
            toJSON: () => licenseData,
            save: jest.fn(),
            set: jest.fn(),
          });

          mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse2));

          await licenseInit(org, getUserCodesForOrg, getLicenseMetaData, true);
          expect(getLicense(licenseKey)).toEqual(licenseData2);
          expect(fetch).toHaveBeenCalledTimes(2);
        });

        it("should disregard contents if the data doesn't match the signature and return what is in the mongo cache with error fields set", async () => {
          mockedFetch.mockReset(); // this test's fetch result should be different from the others'
          jest.spyOn(LicenseModelModule, "getLicenseByKey").mockRestore(); // this test should expect there to be something in mongo cache
          const licenseDateWithBadSignature = cloneDeep(licenseData);
          licenseDateWithBadSignature.signedChecksum = "bad signature";
          const mockedResponse3: Response = {
            ok: true,
            json: jest.fn().mockResolvedValueOnce(licenseDateWithBadSignature),
          } as unknown as Response; // Create a mock Response object

          mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse3));

          jest
            .spyOn(LicenseModelModule, "getLicenseByKey")
            .mockResolvedValue(cloneDeep(licenseData));

          // Use force refresh to make sure the bad data is returned
          await expect(async () => {
            await licenseInit(
              org,
              getUserCodesForOrg,
              getLicenseMetaData,
              true,
            );
          }).rejects.toThrowError("Invalid license key signature");

          const expectedLicenseData = {
            ...licenseData,
            usingMongoCache: true,
            lastServerErrorMessage: "Invalid license key signature",
            firstFailedFetchDate: now,
            lastFailedFetchDate: now,
          };

          expect(getLicense(licenseKey)).toEqual(expectedLicenseData);
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(LicenseModel.findOneAndReplace).toHaveBeenCalledWith(
            { id: licenseKey },
            expectedLicenseData,
            { upsert: true },
          );
        });
      });

      describe("and when the license server is down", () => {
        beforeEach(() => {
          const mockedResponse: Response = {
            ok: false,
            statusText: "internal server error",
            text: jest.fn().mockResolvedValue("internal server error"),
          } as unknown as Response;

          mockedFetch.mockResolvedValue(Promise.resolve(mockedResponse));
        });

        afterEach(() => {
          mockedFetch.mockReset();
        });

        describe("and when there is no cached data in LicenseModel", () => {
          beforeEach(() => {
            jest
              .spyOn(LicenseModelModule, "getLicenseByKey")
              .mockResolvedValue(null);

            // Mock out the constructor so new LicenseModel(data) => data
            jest
              .spyOn(LicenseModelModule, "LicenseModel")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .mockImplementation((data: any) => {
                return data;
              });
          });

          it("should throw error if the license server is down and there is no cached data in LicenseModel", async () => {
            await expect(async () => {
              await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
            }).rejects.toThrowError(
              "License server errored with: internal server error",
            );
            expect(getLicense(licenseKey)).toEqual({
              firstFailedFetchDate: now,
              id: "license_19exntswvlosvp1d6",
              lastServerErrorMessage:
                "License server errored with: internal server error",
              lastFailedFetchDate: now,
              usingMongoCache: true,
            });
          });
        });

        describe("and when there is cached data in LicenseModel", () => {
          beforeEach(() => {
            jest
              .spyOn(LicenseModelModule, "getLicenseByKey")
              .mockResolvedValue(cloneDeep(licenseData));
          });

          it("should throw an error if force refresh is true and save the failures in the mongo cache", async () => {
            await expect(async () => {
              await licenseInit(
                org,
                getUserCodesForOrg,
                getLicenseMetaData,
                true,
              );
            }).rejects.toThrowError(
              "License server errored with: internal server error",
            );

            const expectedLicense = {
              ...licenseData,
              usingMongoCache: true,
              firstFailedFetchDate: new Date(now),
              lastFailedFetchDate: new Date(now),
              lastServerErrorMessage:
                "License server errored with: internal server error",
            };

            expect(LicenseModel.findOneAndReplace).toHaveBeenCalledTimes(1);
            expect(LicenseModel.findOneAndReplace).toHaveBeenCalledWith(
              { id: licenseKey },
              expectedLicense,
              { upsert: true },
            );

            expect(getLicense(licenseKey)).toEqual(expectedLicense);
          });

          it("should fetch in the background and return cache from LicenseModel if a cache exists in licenseModel that is between 2 and 7 days and save the failures in the mongo cache", async () => {
            const firstCallTime = now.getTime() + 2 * 24 * 60 * 60 * 1000;
            jest.setSystemTime(firstCallTime);

            await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

            // The previous license data in mongo cache should be returned as it calls the license server in the background
            expect(getLicense(licenseKey)).toEqual({
              ...licenseData,
              usingMongoCache: true,
            });

            await backgroundUpdateLicenseFromServerForTests;

            const expectedLicenseData = {
              ...licenseData,
              usingMongoCache: true,
              firstFailedFetchDate: new Date(firstCallTime),
              lastFailedFetchDate: new Date(firstCallTime),
              lastServerErrorMessage:
                "License server errored with: internal server error",
            };
            expect(getLicense(licenseKey)).toEqual(expectedLicenseData);
            expect(LicenseModel.findOneAndReplace).toHaveBeenCalledTimes(1);
            expect(LicenseModel.findOneAndReplace).toHaveBeenCalledWith(
              { id: licenseKey },
              expectedLicenseData,
              { upsert: true },
            );

            const mockedResponse: Response = {
              ok: false,
              statusText: "different error",
              text: jest.fn().mockResolvedValueOnce("different error"),
            } as unknown as Response;

            mockedFetch.mockResolvedValue(Promise.resolve(mockedResponse));

            const secondCallTime = now.getTime() + 4 * 24 * 60 * 60 * 1000;
            jest.setSystemTime(secondCallTime);
            await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

            // The previous license data in mongo cache should be returned as it calls the license server in the background
            expect(getLicense(licenseKey)).toEqual(expectedLicenseData);

            await backgroundUpdateLicenseFromServerForTests;

            const updatedLicenseData = {
              ...licenseData,
              usingMongoCache: true,
              firstFailedFetchDate: new Date(firstCallTime),
              lastFailedFetchDate: new Date(secondCallTime),
              lastServerErrorMessage:
                "License server errored with: different error",
            };
            expect(getLicense(licenseKey)).toEqual(updatedLicenseData);

            expect(LicenseModel.findOneAndReplace).toHaveBeenCalledTimes(2);
            expect(LicenseModel.findOneAndReplace).toHaveBeenCalledWith(
              { id: licenseKey },
              updatedLicenseData,
              { upsert: true },
            );
          });

          it("should return the cache that exists if it was last updated too long ago (getLicenseError will return a too old message)", async () => {
            const callTime = now.getTime() + 8 * 24 * 60 * 60 * 1000;
            jest.setSystemTime(callTime);

            await expect(async () => {
              await licenseInit(
                org,
                getUserCodesForOrg,
                getLicenseMetaData,
                true,
              );
            }).rejects.toThrowError(
              "License server errored with: internal server error",
            );

            expect(getLicense(licenseKey)).toEqual({
              ...licenseData,
              usingMongoCache: true,
              firstFailedFetchDate: new Date(callTime),
              lastFailedFetchDate: new Date(callTime),
              lastServerErrorMessage:
                "License server errored with: internal server error",
            });
          });
        });

        describe("and when there is cached data in LicenseModel but it is an initial error (never has been a successful call to the license server)", () => {
          beforeEach(() => {
            const expectedFirstFailedFetchCache = {
              id: licenseKey,
              firstFailedFetchDate: "past",
            };
            jest
              .spyOn(LicenseModelModule, "getLicenseByKey")
              // @ts-expect-error - when the first call to initLisense fails, we save a stub LicenseKey.
              .mockResolvedValue(cloneDeep(expectedFirstFailedFetchCache));
          });

          it("should await fetch", async () => {
            await expect(async () => {
              await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
            }).rejects.toThrowError(
              "License server errored with: internal server error",
            );

            expect(getLicense(licenseKey)).toEqual({
              id: licenseKey,
              usingMongoCache: true,
              firstFailedFetchDate: "past",
              lastFailedFetchDate: new Date(now),
              lastServerErrorMessage:
                "License server errored with: internal server error",
            });
          });
        });
      });
    });

    describe("old style licenses where licenseKey does NOT start with 'license_' but contains the license data encoded in itself", () => {
      const orgWithOldKey = { id: "org_123", licenseKey: oldLicenseKey };

      it("should use the env variable if the licenseKey argument references an expired license", async () => {
        const licenseData3 = cloneDeep(licenseData);
        const tenDaysAgo = new Date(now);
        tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
        licenseData3.dateExpires = tenDaysAgo.toISOString();
        licenseData3.signedChecksum =
          "O8U7fSZb2eA_NIi6N5MJSxqsHNZ98E_nkoyBK7tQ_0pIGhXpQCrAy04ec_l_YLiNCVR8UKeZVQuf58_bdgBCXVQsEZSWDRSpmf_8lw3NjwHEBgh9KdDzsZVIN-bzywA27sQIsR4MS6kmZOgm2ml91WfRblCUf9q6kbXfXFBKgtt-afGUZDqYVnC-bPbZvoRKmyREpnw3u-CMlTvMPrxkpUuRCCWWcQe6o5S7LUW_L3Z9e-9kEEYC3mh2ERnjojSblR_sdSa_mDgLA20p9w0_Amhrw-6zKIi6ZyMUHHz3iUKXjvEpp4OqqHhm5Fooax07Hn4e18Om9ZisaZ22IRKeJyjjuZdGMnK3cfNhUaHkWW_FSHaDnTouQRdtA-hBP5l4ktauLKKVKuomvwunDq5-MHrcENfcUedV6eB68R0OGEi8bQVCGSnLrO48gTrQzbwVem5EAgr1n7PwpCdzZntUZfQ9QnoPhRRBPNFPGcCJih4ZlOsuDpYRpie7ritAupI7sRbuw_vk00fEBb0NAqA5pNBH7JMjUPhsUwYtXJumkbHZt8p1gz1U5A9UIgZT8rjiwHifqgOyo435M2xcHDHqPahjRDq8K11NZATNAf9AFlnIPPiYg-hHMIhugArpG-EuOsEekVQqjzGfm6CC24f6cyllhRYk22ae04cdbcm4iaA";
        const mockedResponse3: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData3),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse3));

        process.env.LICENSE_KEY = oldLicenseKey;
        const result = await licenseInit(
          org,
          getUserCodesForOrg,
          getLicenseMetaData,
        );

        expect(getLicense(licenseKey)).toEqual(oldLicenseData);
        expect(result).toEqual(oldLicenseData);
      });

      it("should not use the env variable if the licenseKey argument does not reference an expired license", async () => {
        const mockedResponse: Response = {
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData),
        } as unknown as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));

        process.env.LICENSE_KEY = oldLicenseKey;
        const result = await licenseInit(
          org,
          getUserCodesForOrg,
          getLicenseMetaData,
        );

        expect(getLicense(licenseKey)).toEqual(licenseData);
        expect(result).toEqual(licenseData);
      });

      it("should read license data from the key itself and use the in-memory cache if called a second time, even if a long time has passed, as old style license keys should never expire", async () => {
        await licenseInit(orgWithOldKey);

        expect(getLicense(oldLicenseKey)).toEqual(oldLicenseData);

        const tenYearsFromNow =
          old_license_now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000;
        jest.setSystemTime(tenYearsFromNow);
        jest.spyOn(JSON, "parse").mockReturnValue({ foo: "bar" }); // This is an invalid license, but we should use the cache so won't see an error.

        await licenseInit(
          orgWithOldKey,
          getUserCodesForOrg,
          getLicenseMetaData,
        );
        expect(getLicense(oldLicenseKey)).toEqual(oldLicenseData);
      });

      it("should throw an error if the data doesn't match the signature", async () => {
        await expect(
          async () =>
            await licenseInit({
              id: org.id,
              licenseKey: oldLicenseKey + "extrasignature",
            }),
        ).rejects.toThrowError("Invalid license key signature");
      });

      it("should use the old expiry date 'eat' if the new one 'exp' is not present", async () => {
        const oldLicenseOriginalData2 = cloneDeep(oldLicenseOrginalData);
        // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
        oldLicenseOriginalData2.eat = oldLicenseOriginalData2.exp;
        // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
        delete oldLicenseOriginalData2.exp;
        jest.spyOn(JSON, "parse").mockReturnValue(oldLicenseOriginalData2);

        await licenseInit(orgWithOldKey);

        expect(getLicense(oldLicenseKey)).toEqual(oldLicenseData);
      });

      it("should throw an error if there is no expiry date on the license", async () => {
        const oldLicenseOriginalData2 = cloneDeep(oldLicenseOrginalData);
        // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
        delete oldLicenseOriginalData2.exp;
        jest.spyOn(JSON, "parse").mockReturnValue(oldLicenseOriginalData2);

        await expect(async () => {
          await licenseInit(orgWithOldKey);
        }).rejects.toThrowError(
          "Invalid License Key - Missing expiration date",
        );
      });

      it("should automatically assume enterprise plan if no plan is specified", async () => {
        const oldLicenseOriginalData2 = cloneDeep(oldLicenseOrginalData);
        // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
        delete oldLicenseOriginalData2.plan;
        jest.spyOn(JSON, "parse").mockReturnValue(oldLicenseOriginalData2);

        await licenseInit(orgWithOldKey);

        const expected = cloneDeep(oldLicenseData);
        expected.plan = "enterprise";
        expect(getLicense(oldLicenseKey)).toEqual(expected);
      });
    });
  });
});
