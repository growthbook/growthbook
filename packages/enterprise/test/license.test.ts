import fetch, { Response } from "node-fetch";

import cloneDeep from "lodash/cloneDeep";
import {
  LICENSE_SERVER,
  licenseInit,
  getLicense,
  resetInMemoryLicenseCache,
} from "../src/license";
import { LicenseModel } from "../src/models/licenseModel";

jest.mock("node-fetch");
jest.mock("../src/models/licenseModel");

const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe("licenseInit", () => {
  const env = process.env;
  const userLicenseCodes = ["code1", "code2"];
  const metaData = {
    installationId: "installation-04ed35f0-806c-4ecb-b148-051bc42dd3e1",
    gitSha: "gitSha",
    gitCommitDate: "2023-01-01",
    sdkLanguages: ["node"],
    dataSourceTypes: ["postgres"],
    eventTrackers: ["rudderstack"],
    isCloud: false,
  };
  const licenseKey = "license_19exntswvlosvp1d6";
  const licenseData = {
    id: "license_19exntswvlosvp1d6",
    companyName: "Acme",
    organizationId: "",
    seats: 1,
    isTrial: true,
    plan: "starter",
    archived: false,
    dateCreated: "2023-11-10T17:15:11.274Z",
    dateExpires: "2024-10-23T00:00:00.000Z",
    dateUpdated: "2023-11-17T19:45:04.713Z",
    seatsInUse: 1,
    installationUsers: {
      "installation-04ed35f0-806c-4ecb-b148-051bc42dd3e1": {
        date: "2023-11-17T19:48:38.562Z",
        userHashes: ["6ef56f32"],
      },
    },
    signedChecksum:
      "F43WDJiuC6pdQR7SChJBKgHbGSFfwday5pOPjmdnB1MZcMZyrL2zXFrhmwu_nzONLUSVGGgkgYP3y8S0thoTD-MsA-GRzHzR3Bzm-QyuMVUFCuw8I2xsUPuaR36nRRnk0cgixFBEQDFVLkLf3LVwltKh6LS1IWwyCGY5gkOIZ1idFzl5IfTIqlDdbv8Ca1Sp-v58MrycVHz5zvBNz9H2DtsGLTF1XBxP-SydFSGvE7BD3B5qb1DKqW7WMiLvvitzbvBkECMnIjxZtx0KB0AHJfIyIB8zE9d1smW9kDoi58VtudIM3NO6oc0-09rA3MqYgBck53TluADOGLTmKdI5mZOFI7saFme5PJ1MkmeD5ExmJwormhIUt3Pc5PPzN8Z_XCcla_gZiyfx-OLuKdcZafbd-njIDuG_h2TPqvvyKGgcayBugNlvl-2MFQupwrARO3MWGfA-IV6dcU_zQ7uklkzjcKvpWwNZD5MRKEmdNOZANGkWWRMUoeJOjPk9Ot9jTsrFxJEdGr-r6uuZQGCDhv2MOu6MXDKe7Q7iKIa1DhZlvn_e4g2_k8b8X123m79-XLE6KJaJw74yUNkH-8zOPV9nArvfJ37Kf88pVW1vgVRdhZmGGF8DWzphbV4BlIz257YNZAaOkwNlf874QWbtXWFZwWdJqCDMagwe74cjBQ8",
  };
  const licenseData2 = cloneDeep(licenseData);
  licenseData2.seatsInUse = 2;
  const oldLicenseKey =
    "eyJyZWYiOiIyNDAzMjEiLCJzdWIiOiJBY21lIiwib3JnIjoib3JnXzEyMyIsInF0eSI6MywiaWF0IjoiMjAyMy0xMS0xOCIsImV4cCI6IjIwMjMtMTEtMTkiLCJ0cmlhbCI6dHJ1ZSwicGxhbiI6InBybyJ9.Wf_rdgs4Ice1aFImF9bFBVeyP3gfo1V9CyNh9U5kJguKvzpLJEDE7x1bU4zsenaY-sBBv_IeD5UrCf-7ktcW9AQBuQa_c8IK96Dq57gCDGJ5fmTpqL8jZJF9d0HJd-uDhbXqNXway7a3MLK7lwo9BxD4ZiANafrn9qKH0tB30gUChCm61h9trxDmcWIGYi9HFtICvqkKLXthgKgQYV7pHhnB3BzhUXu6p2iDURSIQhergUv3y833tjJ-I_rtMxpeKumJOHAqQDPF3hlNzL4y6WIVAp0RyDEYD3PyfQVsJpY5QRK2cZEwWJr_JRFOmou5O79oZjyAPsbjw2J-41BsNGnshA00MS6l74Aae1zFES10zwxo0En8TS5CqrwIW05hSs1pp-UKM56RFsPTjayGmiGdUSGf7vMo4e7RtE73T9RIntbfqTXYg2FTPiergiYr7gVBPi-JNiicwKOxGChoaIwVkha8Pp3B9yUfTyjWNEm0S9xTlv3l8dRmla2_62YAU3hlvQqZQvRXciOrMPyBQnPuQq9srRSFi2kFYMefgXCSTnFSi9pz9uOiJix7REYlEVOq_qujoRVYHY2h7zZwsIBiR_jCZTX8gJXxPDSDseiWzgXY11YZNWuNC551cRrBurNP1M_M_Z6-A7IXyfrhzBJizYw6a81R6NBBulCVDLc";

  const oldLicenseOrginalData = {
    ref: "240321",
    sub: "Acme",
    org: "org_123",
    qty: 3,
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
    isTrial: true,
    dateCreated: "2023-11-18",
    dateExpires: "2023-11-19",
    plan: "pro",
  };

  const now = new Date(2023, 10, 18, 19, 45, 4, 713);

  async function testSSOError(licenseKey) {
    process.env.SSO_CONFIG = "true";

    expect.assertions(1);

    await expect(async () => {
      await licenseInit(userLicenseCodes, metaData, licenseKey);
    }).rejects.toThrowError("Your License Key does not support SSO.");
  }

  async function testMultiOrgError(licenseKey) {
    process.env.IS_MULTI_ORG = "true";

    expect.assertions(1);

    await expect(async () => {
      await licenseInit(userLicenseCodes, metaData, licenseKey);
    }).rejects.toThrowError(
      "Your License Key does not support multiple organizations."
    );
  }

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
    jest.spyOn(LicenseModel, "findOne").mockRestore();
    jest.useRealTimers();
    process.env = env;
  });

  it("should set licenseData to null if licenseKey is not provided", async () => {
    const result = await licenseInit(userLicenseCodes, metaData);

    expect(result).toBeUndefined();
    expect(getLicense()).toBeNull;
  });

  describe("new style licenses where licenseKey starts with 'license_'", () => {
    describe("and when the license server is up", () => {
      beforeEach(() => {
        const mockedResponse: Response = ({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData),
        } as unknown) as Response; // Create a mock Response object

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
      });

      afterEach(() => {
        mockedFetch.mockReset();
      });

      it("should call fetch once and the second time return in-memory cached license data if it exists and is not too old", async () => {
        await licenseInit(userLicenseCodes, metaData, licenseKey);

        expect(fetch).toHaveBeenCalledWith(
          `${LICENSE_SERVER}/api/v1/license/${licenseKey}/check`,
          expect.objectContaining({
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userHashes: userLicenseCodes,
              metaData,
            }),
          })
        );

        expect(getLicense()).toEqual(licenseData);

        await licenseInit(userLicenseCodes, metaData, licenseKey);
        expect(getLicense()).toEqual(licenseData);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(LicenseModel.create).toHaveBeenCalledTimes(1);

        const updatedLicenseData = cloneDeep(licenseData);
        updatedLicenseData.dateUpdated = new Date(now).toISOString();
        expect(LicenseModel.create).toHaveBeenCalledWith(updatedLicenseData);
      });

      it("should call fetch twice rather than use the in-memory cache if it has been over a day since the last fetch, and update the licenseData", async () => {
        await licenseInit(userLicenseCodes, metaData, licenseKey);

        expect(fetch).toHaveBeenCalledWith(
          `${LICENSE_SERVER}/api/v1/license/${licenseKey}/check`,
          expect.objectContaining({
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userHashes: userLicenseCodes,
              metaData,
            }),
          })
        );

        expect(getLicense()).toEqual(licenseData);
        const tenDaysFromNow = now.getTime() + 10 * 24 * 60 * 60 * 1000;
        jest.setSystemTime(tenDaysFromNow);

        const mockedResponse2: Response = ({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData2),
        } as unknown) as Response; // Create a mock Response object

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse2));

        await licenseInit(userLicenseCodes, metaData, licenseKey);
        expect(getLicense()).toEqual(licenseData2);
        expect(fetch).toHaveBeenCalledTimes(2);
      });

      it("should throw an error if the plan does not support sso but the env var says it is enabled", async () => {
        testSSOError(licenseKey);
      });

      it("should throw an error if the plan does not support multi-org but the env var says it is enabled", async () => {
        testMultiOrgError(licenseKey);
      });
    });

    describe("and when the license server is down", () => {
      beforeEach(() => {
        const mockedResponse: Response = ({
          ok: false,
        } as unknown) as Response; // Create a mock Response object

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
      });

      afterEach(() => {
        mockedFetch.mockReset();
      });

      describe("and when there is no cached data in LicenseModel", () => {
        it("should throw error if the license server is down and there is no cached data in LicenseModel", async () => {
          await expect(
            async () =>
              await licenseInit(userLicenseCodes, metaData, licenseKey)
          ).rejects.toThrowError(
            "License server is not working and no cached license data exists"
          );
        });
      });

      describe("and when there is cached data in LicenseModel", () => {
        beforeEach(() => {
          jest.spyOn(LicenseModel, "findOne").mockResolvedValue(licenseData);
        });

        it("should return cache from LicenseModel if the license server is down and a cache exists in licenseModel", async () => {
          const mockedResponse: Response = ({
            ok: false,
          } as unknown) as Response; // Create a mock Response object

          mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
          await licenseInit(userLicenseCodes, metaData, licenseKey);

          expect(getLicense()).toEqual(licenseData);
        });

        it("should throw an error if the license server is down and a cache exists in licenseModel but it is older than 7 days.", async () => {
          jest.setSystemTime(now.getTime() + 8 * 24 * 60 * 60 * 1000);

          await expect(
            async () =>
              await licenseInit(userLicenseCodes, metaData, licenseKey)
          ).rejects.toThrowError(
            "License server is not working and cached license data is too old"
          );
        });

        it("should throw an error if the plan does not support sso but the env var says it is enabled", async () => {
          await testSSOError(licenseKey);
        });

        it("should throw an error if the plan does not support multi-org but the env var says it is enabled", async () => {
          await testMultiOrgError(licenseKey);
        });
      });
    });
  });

  describe("old style licenses where licenseKey does NOT start with 'license_' but contains the license data encoded in itself", () => {
    it("should read license data from the key itself and use the in-memory cache if called a second time, even if a long time has passed", async () => {
      await licenseInit(userLicenseCodes, metaData, oldLicenseKey);

      expect(getLicense()).toEqual(oldLicenseData);

      const tenYearsFromNow = now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000;
      jest.setSystemTime(tenYearsFromNow);
      jest.spyOn(JSON, "parse").mockReturnValue({ foo: "bar" }); // This is an invalid license, but we should use the cache so won't see an error.

      expect(getLicense()).toEqual(oldLicenseData);
    });

    it("should throw an error if the data doesn't match the signature", async () => {
      await expect(
        async () =>
          await licenseInit(
            userLicenseCodes,
            metaData,
            oldLicenseKey + "extrasignature"
          )
      ).rejects.toThrowError("Invalid license key signature");
    });

    it("should use the old expiry date 'eat' if the new one 'exp' is not present", async () => {
      const oldLicenseOriginalData2 = cloneDeep(oldLicenseOrginalData);
      // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
      oldLicenseOriginalData2.eat = oldLicenseOriginalData2.exp;
      // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
      delete oldLicenseOriginalData2.exp;
      jest.spyOn(JSON, "parse").mockReturnValue(oldLicenseOriginalData2);

      await licenseInit(userLicenseCodes, metaData, oldLicenseKey);

      expect(getLicense()).toEqual(oldLicenseData);
    });

    it("should throw an error if there is no expiry date on the license", async () => {
      const oldLicenseOriginalData2 = cloneDeep(oldLicenseOrginalData);
      // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
      delete oldLicenseOriginalData2.exp;
      jest.spyOn(JSON, "parse").mockReturnValue(oldLicenseOriginalData2);

      await expect(async () => {
        await licenseInit(userLicenseCodes, metaData, oldLicenseKey);
      }).rejects.toThrowError("Invalid License Key - Missing expiration date");
    });

    it("should throw an error if the license has expired", async () => {
      jest.setSystemTime(now.getTime() + 8 * 24 * 60 * 60 * 1000);
      await expect(async () => {
        await licenseInit(userLicenseCodes, metaData, oldLicenseKey);
      }).rejects.toThrowError("Your License Key trial expired on");
    });

    it("should automatically assume enterprise plan if no plan is specified", async () => {
      const oldLicenseOriginalData2 = cloneDeep(oldLicenseOrginalData);
      // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
      delete oldLicenseOriginalData2.plan;
      jest.spyOn(JSON, "parse").mockReturnValue(oldLicenseOriginalData2);

      await licenseInit(userLicenseCodes, metaData, oldLicenseKey);

      const expected = cloneDeep(oldLicenseData);
      expected.plan = "enterprise";
      expect(getLicense()).toEqual(expected);
    });

    it("should throw an error if the plan does not support sso but the env var says it is enabled", async () => {
      await testSSOError(oldLicenseKey);
    });

    it("should throw an error if the plan does not support multi-org but the env var says it is enabled", async () => {
      await testMultiOrgError(oldLicenseKey);
    });
  });
});
