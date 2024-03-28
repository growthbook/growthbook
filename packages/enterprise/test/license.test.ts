import fetch, { Response } from "node-fetch";

import cloneDeep from "lodash/cloneDeep";
import {
  LICENSE_SERVER_URL,
  licenseInit,
  getLicense,
  resetInMemoryLicenseCache,
} from "../src/license";
import { LicenseModel } from "../src/models/licenseModel";

jest.mock("node-fetch");
jest.mock("../src/models/licenseModel");

const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe("licenseInit and getLicense", () => {
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
    dateUpdated: "2023-11-21T12:08:12.610Z",
    seatsInUse: 1,
    installationUsers: {
      "installation-04ed35f0-806c-4ecb-b148-051bc42dd3e1": {
        date: "2023-11-17T19:48:38.562Z",
        userHashes: ["6ef56f32"],
      },
    },
    signedChecksum:
      "JbSjKDDBxAu-8BtOrBCsPMl9vGUpdIYwOi6AIHdLE9y7NJfdsjK_oMeL8FrSY9BiBOIrzLR3qV6_AG-62L-nd5HOHo_YTbrCKCrOKxVO1_HpqzbBcfBaMIIF___7GYilnH5vncnJxIhxu3n2ZJTnmbjVfCGkz6-NEiU-oI5ifGI1akK7l3kTTz-X7M0N3c-8vkt2AwbxmBq0MoVU0Ekrf25_ybexRZVY0LhjHX_DYjQwCbZafdtC5E-1XsfvTX-zyUo2pZP7lEyGcV8BQso1psLB5AAt_2m8aMNJTK5Gi6JhA8wepyiel-G8dCTCjHs7NrVHqbn9uNVnAtUwpcFJcscJx0ZWcJXMFwrkKBp-jq6i94-1ridYJO1DFnGy23iTKAaKmcP5QLhbPaCBm4_EYMp2k4BQPHbRQyERzDF-I2rRphJGa3h3ZAUJjdjcnDzqinnDJcnqU1waWauIclvE51l3g0LFL6YTg4CSZm0VavKfrvcK2-ofCD66kuFhXVoxg3rUvufC1SWd9RoMCd8BEng3XEPzJIOD4f_s8Nl8XAldlQVDj4gUKm_Jb5tUYi2CQwti6PVg39XGFLw7CxrndeLZ46jd35k10HMXzkEvL_wCswh9e2NEzKDc-sHfjmNMqm5R2xNd2pfwIMyjFUQZCHcXn58QysX5dARJbHRJjH0",
  };
  const licenseData2 = cloneDeep(licenseData);
  licenseData2.seatsInUse = 2;
  licenseData2.signedChecksum =
    "DHUuQecjo2Q4NDY3Xz69d6SR2n7lvmf2YL8Nbg8no3-YGN3tv4x8T1saKA5lHcW2VDTH9OXSLHNZNIMZFZUu-a6kZigC8QHykYOHYomyBzOzwjrbH2iSoLcEhucyyWzKAts6wWGrSkyjosXD1tFi9O1loShdmKc16hTunt4NNOHRmJ_ae-V8fWiQHPVrZ7c9tHrcCbXPgONvcNBYq4GRC-mx2aVH1rXoxDQe0sbwHFlOoRbDshPmfR7LBSWbPgQ_ptI8jlaJ1Jko_IClK2EsZYthGfcNjnZOPXz2_Kiwd6U7VY0uMBd6YvWj-rsd5vgTQUaiXl7CRJp3Y6ZDqdLvz1lQOMWw7gOxh_T3djYStWsNcCVBXQn5fqG-81AOY_hsABG21sM8XR4Or8JwmjEWHsjI0pObgD-bptEcTJhMmLQaLnoj77IyRNwQJeVVMm3DKpayugFBSZp71FrhNvfI2hv92QTzaN6OludkfUGspI-_aFbfP2m69xwVf-f0r2iELzlkOB-aCsK1daltFeDD-F1m-Bc-Do3NVrquM4mMuYkvJ9G2OxVO_lioCLE4f_BwawB71BXLQRrGxsV8mF6F3ZST0pytfZSlSkX5iHBVFTE8J2eIlcZXuMgh6Jj2ZS1qCiAsUn6EknEE1GcemOHbykkxNG_835Iati3Y4obBx3k";

  const now = new Date("2023-11-21T12:08:12.610Z");

  async function testSSOError(licenseKey) {
    process.env.SSO_CONFIG = "true";

    expect.assertions(1);

    await expect(
      licenseInit(licenseKey, userLicenseCodes, metaData)
    ).rejects.toThrowError("Your License Key does not support SSO.");
  }

  async function testMultiOrgError(licenseKey) {
    process.env.IS_MULTI_ORG = "true";

    expect.assertions(1);

    await expect(
      licenseInit(licenseKey, userLicenseCodes, metaData)
    ).rejects.toThrowError(
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

  it("should not be calling localhost for the license server", async () => {
    expect(LICENSE_SERVER_URL).not.toContain("localhost");
  });

  it("should set licenseData to null if licenseKey is not provided", async () => {
    const result = await licenseInit(undefined, userLicenseCodes, metaData);

    expect(result).toBeUndefined();
    expect(getLicense()).toBeNull();
  });

  describe("new style licenses where licenseKey starts with 'license_'", () => {
    describe("and when the license server is up", () => {
      beforeEach(() => {
        const mockedResponse: Response = ({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData),
        } as unknown) as Response;

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
      });

      afterEach(() => {
        mockedFetch.mockReset();
      });

      it("should use the env variable if licenseKey argument is not provided", async () => {
        process.env.LICENSE_KEY = licenseKey;
        const result = await licenseInit(undefined, userLicenseCodes, metaData);

        expect(getLicense()).toEqual(licenseData);
        expect(result).toEqual(licenseData);
      });

      it("should throw an error if we call the function without userLicenseCodes or metadata", async () => {
        expect.assertions(2);

        await expect(
          licenseInit(licenseKey, userLicenseCodes, undefined)
        ).rejects.toThrowError(
          "Missing userLicenseCodes or metaData for license key"
        );

        await expect(
          licenseInit(licenseKey, undefined, metaData)
        ).rejects.toThrowError(
          "Missing userLicenseCodes or metaData for license key"
        );
      });

      it("should call fetch once and the second time return in-memory cached license data if it exists and is not too old", async () => {
        await licenseInit(licenseKey, userLicenseCodes, metaData);

        expect(fetch).toHaveBeenCalledWith(
          `${LICENSE_SERVER_URL}license/${licenseKey}/check`,
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

        expect(getLicense(licenseKey)).toEqual(licenseData);

        await licenseInit(licenseKey, userLicenseCodes, metaData);
        expect(getLicense(licenseKey)).toEqual(licenseData);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(LicenseModel.create).toHaveBeenCalledTimes(1);
        expect(LicenseModel.create).toHaveBeenCalledWith(licenseData);
        expect(LicenseModel.findOne).toHaveBeenCalledTimes(1);
      });

      it("should fetch the license from datastore if it is not in memory", async () => {
        await licenseInit(licenseKey, userLicenseCodes, metaData);

        expect(fetch).toHaveBeenCalledWith(
          `${LICENSE_SERVER_URL}license/${licenseKey}/check`,
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

        expect(getLicense(licenseKey)).toEqual(licenseData);
        resetInMemoryLicenseCache();
        jest.spyOn(LicenseModel, "findOne").mockResolvedValue({
          ...licenseData,
          toJSON: () => licenseData,
          save: jest.fn(),
          set: jest.fn(),
        });
        await licenseInit(licenseKey, userLicenseCodes, metaData);

        expect(getLicense(licenseKey)).toEqual(licenseData);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(LicenseModel.create).toHaveBeenCalledTimes(1);
        expect(LicenseModel.create).toHaveBeenCalledWith(licenseData);
        expect(LicenseModel.findOne).toHaveBeenCalledTimes(2);
      });

      it("should fetch the license from the license server if the license is not in memory and the datastore is too old", async () => {
        await licenseInit(licenseKey, userLicenseCodes, metaData);

        expect(fetch).toHaveBeenCalledWith(
          `${LICENSE_SERVER_URL}license/${licenseKey}/check`,
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

        expect(getLicense(licenseKey)).toEqual(licenseData);

        jest.spyOn(LicenseModel, "findOne").mockResolvedValue({
          ...licenseData,
          toJSON: () => licenseData,
          save: jest.fn(),
          set: jest.fn(),
        });

        const twoDaysFromNow = now.getTime() + 2 * 24 * 60 * 60 * 1000;
        jest.setSystemTime(twoDaysFromNow);

        const mockedResponse2: Response = ({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData2),
        } as unknown) as Response; // Create a mock Response object

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse2));

        await licenseInit(licenseKey, userLicenseCodes, metaData);
        expect(getLicense(licenseKey)).toEqual(licenseData2);
        expect(fetch).toHaveBeenCalledTimes(2);
      });

      it("should call fetch once for each key when called with multiple keys simultaneously, and getLicense should return correct licenseData for each key", async () => {
        mockedFetch.mockReset(); // this test is different from the others

        const licenseKey2 = "license_19exntswvlosvp1dasdfads";
        const mockedResponse: Response = ({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData),
        } as unknown) as Response;

        const licenseData3 = cloneDeep(licenseData2);
        licenseData3.id = licenseKey2;

        const mockedResponse2: Response = ({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData3),
        } as unknown) as Response;

        mockedFetch
          .mockResolvedValueOnce(Promise.resolve(mockedResponse))
          .mockResolvedValueOnce(Promise.resolve(mockedResponse2));

        // Number of concurrent requests
        const numRequests = 10;

        // Execute multiple concurrent requests
        const results = await Promise.all(
          Array.from({ length: numRequests }).map(async (_, i) => {
            if (i % 2 === 0) {
              return await licenseInit(licenseKey, userLicenseCodes, metaData);
            } else {
              return await licenseInit(licenseKey2, userLicenseCodes, metaData);
            }
          })
        );

        expect(fetch).toHaveBeenCalledTimes(2);

        expect(results[0]).toEqual(licenseData);
        expect(results[1]).toEqual(licenseData3);
        expect(
          results.every((result, i) =>
            i % 2 === 0 ? result === licenseData : result === licenseData3
          )
        ).toBe(true);

        expect(getLicense(licenseKey)).toEqual(licenseData);
        expect(getLicense(licenseKey2)).toEqual(licenseData3);
      });

      it("should call fetch twice rather than use the in-memory cache if it has been over a day since the last fetch, and update the licenseData", async () => {
        await licenseInit(licenseKey, userLicenseCodes, metaData);

        expect(fetch).toHaveBeenCalledWith(
          `${LICENSE_SERVER_URL}license/${licenseKey}/check`,
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

        expect(getLicense(licenseKey)).toEqual(licenseData);
        const tenDaysFromNow = now.getTime() + 10 * 24 * 60 * 60 * 1000;
        jest.setSystemTime(tenDaysFromNow);

        const mockedResponse2: Response = ({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData2),
        } as unknown) as Response; // Create a mock Response object

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse2));

        await licenseInit(licenseKey, userLicenseCodes, metaData);
        expect(getLicense(licenseKey)).toEqual(licenseData2);
        expect(fetch).toHaveBeenCalledTimes(2);
      });

      it("should call fetch twice rather than use the in-memory cache if forceRefresh flag is true", async () => {
        await licenseInit(licenseKey, userLicenseCodes, metaData);

        expect(getLicense(licenseKey)).toEqual(licenseData);

        const mockedResponse2: Response = ({
          ok: true,
          json: jest.fn().mockResolvedValueOnce(licenseData2),
        } as unknown) as Response; // Create a mock Response object

        mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse2));

        await licenseInit(licenseKey, userLicenseCodes, metaData, true);
        expect(getLicense(licenseKey)).toEqual(licenseData2);
        expect(fetch).toHaveBeenCalledTimes(2);
      });

      it("should throw an error if the plan does not support sso but the env var says it is enabled", async () => {
        await testSSOError(licenseKey);
      });

      it("should throw an error if the plan does not support multi-org but the env var says it is enabled", async () => {
        await testMultiOrgError(licenseKey);
      });
    });

    describe("and when the license server is down", () => {
      beforeEach(() => {
        const mockedResponse: Response = ({
          ok: false,
          statusText: "internal server error",
          text: jest.fn().mockResolvedValueOnce("internal server error"),
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
              await licenseInit(licenseKey, userLicenseCodes, metaData)
          ).rejects.toThrowError(
            "License server errored with: internal server error"
          );
        });
      });

      describe("and when there is cached data in LicenseModel", () => {
        beforeEach(() => {
          jest.spyOn(LicenseModel, "findOne").mockResolvedValue({
            ...licenseData,
            toJSON: () => licenseData,
            save: jest.fn(),
            set: jest.fn(),
          });
        });

        it("should return cache from LicenseModel if the license server is down and a cache exists in licenseModel that is less than 7 days", async () => {
          jest.setSystemTime(now.getTime() + 2 * 24 * 60 * 60 * 1000);
          const mockedResponse: Response = ({
            ok: false,
          } as unknown) as Response; // Create a mock Response object

          mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));
          await licenseInit(licenseKey, userLicenseCodes, metaData);

          expect(getLicense(licenseKey)).toEqual(licenseData);
        });

        it("should throw an error if the license server is down and a cache exists in licenseModel but it is older than 7 days.", async () => {
          jest.setSystemTime(now.getTime() + 8 * 24 * 60 * 60 * 1000);

          await expect(
            async () =>
              await licenseInit(licenseKey, userLicenseCodes, metaData)
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
    const now2 = new Date(Date.UTC(2023, 10, 18, 18, 45, 4, 713));

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

    it("should use the env variable if the licenseKey argument references an expired license", async () => {
      const licenseData3 = cloneDeep(licenseData);
      const tenDaysAgo = new Date(now2);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      licenseData3.dateExpires = tenDaysAgo.toISOString();
      licenseData3.signedChecksum =
        "n7Xk1JleapEAyV1s78HqeUXX0-e5Yboz02JRIbfB7zkRtx_s0DnH3IqtDGcTCjs76oB3wZfp31Wf47vbNNA5YWWgqr6Ct_R0-he9sA6tpbTfAa3ev67PanXGzJ36Zqe3tpyXz5vkKVlNEwokneIKurggBowuGF14BxDNN_uzFN8DjbHHDuCrFdyqjdII8tg2SfKz7ybbMm-smYfXvhaayLBQdkWpJ1ZwgPeRsnO-suhRyq_dyFuQk7lkS8DGckNDg3GnJCcrM0olxU7S1EMvcj6BUcECkiDF5xDltFXfKQB8SwiWiDjP04OlJDoDxar3z0maTLilIcP6NtzMbUonuJZhj8qwNrYYM79grhMhsS2a3pN1RQ4jxmCbpxs6VNrEM4u8X6hKPLsqoYqlgyV_UPlNo04Fz5iIfTiy45BVyn2uCiMFkRr58tXNILA2dZjhh_V-9nTSRx2A8XZixjQJzXCbQBz_Q3PoPtdAtiFtRdm_ZHLbHP9c64--vfEqtlNVcc4huUvlwsf5ia1CQFnpbbo0-8_qUAWJUkFilo802aiWW-kwyXmXNjP7jEvBkkd8Oc8l2QUjZCbx3PwDhRacQ-ybr2Df9ZIMmeDLlfU2fDO129W0r1KQNVedCRL2oMcnwRbag9sJF2VTZL8ABi5jhWdJJdK6vTTd9p3AcFNDQ3c";
      const mockedResponse3: Response = ({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(licenseData3),
      } as unknown) as Response;

      mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse3));

      process.env.LICENSE_KEY = oldLicenseKey;
      const result = await licenseInit(licenseKey, userLicenseCodes, metaData);

      expect(getLicense(licenseKey)).toEqual(oldLicenseData);
      expect(result).toEqual(oldLicenseData);
    });

    it("should not use the env variable if the licenseKey argument does not reference an expired license", async () => {
      const mockedResponse: Response = ({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(licenseData),
      } as unknown) as Response;

      mockedFetch.mockResolvedValueOnce(Promise.resolve(mockedResponse));

      process.env.LICENSE_KEY = oldLicenseKey;
      const result = await licenseInit(licenseKey, userLicenseCodes, metaData);

      expect(getLicense(licenseKey)).toEqual(licenseData);
      expect(result).toEqual(licenseData);
    });

    it("should read license data from the key itself and use the in-memory cache if called a second time, even if a long time has passed, as old style license keys should never expire", async () => {
      await licenseInit(oldLicenseKey, userLicenseCodes, metaData);

      expect(getLicense(oldLicenseKey)).toEqual(oldLicenseData);

      const tenYearsFromNow = now2.getTime() + 10 * 365 * 24 * 60 * 60 * 1000;
      jest.setSystemTime(tenYearsFromNow);
      jest.spyOn(JSON, "parse").mockReturnValue({ foo: "bar" }); // This is an invalid license, but we should use the cache so won't see an error.

      await licenseInit(oldLicenseKey, userLicenseCodes, metaData);
      expect(getLicense(oldLicenseKey)).toEqual(oldLicenseData);
    });

    it("should throw an error if the data doesn't match the signature", async () => {
      await expect(
        async () =>
          await licenseInit(
            oldLicenseKey + "extrasignature",
            userLicenseCodes,
            metaData
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

      await licenseInit(oldLicenseKey, userLicenseCodes, metaData);

      expect(getLicense(oldLicenseKey)).toEqual(oldLicenseData);
    });

    it("should throw an error if there is no expiry date on the license", async () => {
      const oldLicenseOriginalData2 = cloneDeep(oldLicenseOrginalData);
      // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
      delete oldLicenseOriginalData2.exp;
      jest.spyOn(JSON, "parse").mockReturnValue(oldLicenseOriginalData2);

      await expect(async () => {
        await licenseInit(oldLicenseKey, userLicenseCodes, metaData);
      }).rejects.toThrowError("Invalid License Key - Missing expiration date");
    });

    it("should automatically assume enterprise plan if no plan is specified", async () => {
      const oldLicenseOriginalData2 = cloneDeep(oldLicenseOrginalData);
      // @ts-expect-error Ignoring TypeScript error here because we intentionally passed malformed data for testing purposes
      delete oldLicenseOriginalData2.plan;
      jest.spyOn(JSON, "parse").mockReturnValue(oldLicenseOriginalData2);

      await licenseInit(oldLicenseKey, userLicenseCodes, metaData);

      const expected = cloneDeep(oldLicenseData);
      expected.plan = "enterprise";
      expect(getLicense(oldLicenseKey)).toEqual(expected);
    });

    it("should throw an error if the plan does not support sso but the env var says it is enabled", async () => {
      await testSSOError(oldLicenseKey);
    });

    it("should throw an error if the plan does not support multi-org but the env var says it is enabled", async () => {
      await testMultiOrgError(oldLicenseKey);
    });
  });
});
