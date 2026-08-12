import mongoose from "mongoose";
import { setupApp } from "back-end/test/api/api.setup";
import {
  getConnectionStringWithDeprecatedKeysMigratedForV3to4,
  dbSafeBulkWrite,
  isDuplicateKeyError,
  createWithVersionRetry,
} from "back-end/src/util/mongo.util";

describe("mongo utils", () => {
  describe("getConnectionStringWithDeprecatedKeysMigratedForV3to4", () => {
    it("returns the original string when no replacements are required", () => {
      const input =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin";
      const expected =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin";

      const { url, success, remapped, unsupported } =
        getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

      expect(url).toEqual(expected);
      expect(success).toBe(true);
      expect(remapped).toEqual([]);
      expect(unsupported).toEqual([]);
    });

    describe("when no connection options are provided", () => {
      it("returns the original string when no replacements are required", () => {
        const input = "mongodb://root:password@localhost:27017/growthbook";
        const expected = "mongodb://root:password@localhost:27017/growthbook";

        const { url, success, remapped, unsupported } =
          getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

        expect(url).toEqual(expected);
        expect(success).toBe(true);
        expect(remapped).toEqual([]);
        expect(unsupported).toEqual([]);
      });
    });

    it("returns a modified URI when one of the properties needs to be migrated", () => {
      const input =
        "mongodb://root:password@localhost:27017/growthbook?poolSize=50";
      const expected =
        "mongodb://root:password@localhost:27017/growthbook?maxPoolSize=50";

      const { url, success, remapped, unsupported } =
        getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

      expect(url).toEqual(expected);
      expect(success).toBe(true);
      expect(remapped).toEqual(["poolSize"]);
      expect(unsupported).toEqual([]);
    });

    it("returns a modified URI when several properties need to be migrated", () => {
      const input =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin&poolSize=50&wtimeout=123456&appname=foobar&tlsinsecure=true";
      const expected =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin&maxPoolSize=50&tlsInsecure=true&wtimeoutMS=123456&appName=foobar";

      const { url, success, remapped, unsupported } =
        getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

      expect(url).toEqual(expected);
      expect(success).toBe(true);
      expect(remapped).toEqual([
        "poolSize",
        "tlsinsecure",
        "wtimeout",
        "appname",
      ]);
      expect(unsupported).toEqual([]);
    });

    it("reports unsupported keys when known v3 options without adequate v4 mappings are provided, leaving invalid keys in the connection string", () => {
      const input =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin&poolSize=50&wtimeout=123456&appname=foobar&tlsinsecure=true&autoReconnect=true&reconnectRetries=3&reconnectInterval=300&ha=true&haInterval=300&secondaryAcceptableLatencyMS=1000&acceptableLatencyMS=1000&j=true&connectWithNoPrimary=true&domainsEnabled=false&bufferMaxEntries=10&foo=1&bar=2&baz=3";
      // includes original deprecated keys
      const expected =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin&autoReconnect=true&reconnectRetries=3&reconnectInterval=300&ha=true&haInterval=300&secondaryAcceptableLatencyMS=1000&acceptableLatencyMS=1000&connectWithNoPrimary=true&domainsEnabled=false&bufferMaxEntries=10&foo=1&bar=2&baz=3&maxPoolSize=50&tlsInsecure=true&wtimeoutMS=123456&journal=true&appName=foobar";

      const { url, success, remapped, unsupported } =
        getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

      expect(url).toEqual(expected);
      expect(success).toBe(true);
      expect(remapped).toEqual([
        "poolSize",
        "tlsinsecure",
        "wtimeout",
        "j",
        "appname",
      ]);
      expect(unsupported).toEqual([
        "autoReconnect",
        "reconnectInterval",
        "ha",
        "haInterval",
        "secondaryAcceptableLatencyMS",
        "acceptableLatencyMS",
        "connectWithNoPrimary",
        "domainsEnabled",
        "bufferMaxEntries",
      ]);
    });

    describe("connection strings with replica sets", () => {
      it("performs replacement and reports unsupported keys when known v3 options without adequate v4 mappings are provided, leaving invalid keys in the connection string", () => {
        const input =
          "mongodb://mongodb0.example.com:27017,mongodb1.example.com:27017,mongodb2.example.com:27017/?replicaSet=myReplicaSet&poolSize=50&wtimeout=123456&appname=foobar&tlsinsecure=true&autoReconnect=false&nope=0";
        const expected =
          "mongodb://mongodb0.example.com:27017,mongodb1.example.com:27017,mongodb2.example.com:27017/?replicaSet=myReplicaSet&autoReconnect=false&nope=0&maxPoolSize=50&tlsInsecure=true&wtimeoutMS=123456&appName=foobar";

        const { url, success, remapped, unsupported } =
          getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

        expect(url).toEqual(expected);
        expect(success).toBe(true);
        expect(remapped).toEqual([
          "poolSize",
          "tlsinsecure",
          "wtimeout",
          "appname",
        ]);
        expect(unsupported).toEqual(["autoReconnect"]);
      });
    });
  });

  describe("dbSafeBulkWrite", () => {
    setupApp();
    const collectionName = "bulkWriteTests";
    const _model = mongoose.model(
      collectionName,
      new mongoose.Schema({ id: String, number: Number }),
    );
    const collection = mongoose.connection.collection(collectionName);
    const collectionWithoutBulkWrite = Object.assign(
      Object.create(Object.getPrototypeOf(collection)),
      collection,
    );
    collectionWithoutBulkWrite.bulkWrite = undefined;
    describe.each([true, false])("db has bulkWrite: %s", (useBulkWrite) => {
      const coll = useBulkWrite ? collection : collectionWithoutBulkWrite;
      it("handles bulk insertOne operations", async () => {
        await dbSafeBulkWrite(
          coll,
          Array.from({ length: 1000 }, (_, i) => ({
            insertOne: { document: { id: i.toString(), number: i } },
          })),
        );
        const numDocuments = await collection.countDocuments();
        expect(numDocuments).toEqual(1000);
        const sortedAsc = await collection
          .find({})
          .sort({ number: 1 })
          .toArray();
        expect(sortedAsc[3].number).toEqual(3);
        const sortedDesc = await collection
          .find({})
          .sort({ number: -1 })
          .toArray();
        expect(sortedDesc[3].number).toEqual(996);
      });

      it("handles bulk updateOne operations", async () => {
        await dbSafeBulkWrite(
          coll,
          Array.from({ length: 1000 }, (_, i) => ({
            insertOne: { document: { id: i.toString(), number: 1 } },
          })),
        );
        const grouped = await collection
          .aggregate([
            {
              $group: {
                _id: { number: "$number" },
                count: { $count: {} },
              },
            },
          ])
          .toArray();
        expect(grouped).toStrictEqual([{ _id: { number: 1 }, count: 1000 }]);
        await dbSafeBulkWrite(
          coll,
          Array.from({ length: 10 }, (_, i) => ({
            updateOne: {
              filter: { id: (i * 100).toString() },
              update: { $set: { number: 10 } },
            },
          })),
        );
        const newGrouped = await collection
          .aggregate([
            {
              $group: {
                _id: { number: "$number" },
                count: { $count: {} },
              },
            },
            {
              $sort: {
                _id: 1,
              },
            },
          ])
          .toArray();
        expect(newGrouped).toStrictEqual([
          { _id: { number: 1 }, count: 990 },
          { _id: { number: 10 }, count: 10 },
        ]);
        const updated = await collection
          .find({ number: 10 })
          .sort({ id: 1 })
          .toArray();
        expect(updated.map(({ id }) => id)).toStrictEqual([
          "0",
          "100",
          "200",
          "300",
          "400",
          "500",
          "600",
          "700",
          "800",
          "900",
        ]);
      });

      it("handles bulk updateOne upsert operations", async () => {
        await dbSafeBulkWrite(
          coll,
          Array.from({ length: 10 }, (_, i) => ({
            updateOne: {
              filter: { id: i.toString() },
              update: { $set: { number: i } },
              upsert: true,
            },
          })),
        );

        const inserted = await collection.find({}).sort({ id: 1 }).toArray();
        expect(inserted.map(({ id, number }) => ({ id, number }))).toEqual([
          { id: "0", number: 0 },
          { id: "1", number: 1 },
          { id: "2", number: 2 },
          { id: "3", number: 3 },
          { id: "4", number: 4 },
          { id: "5", number: 5 },
          { id: "6", number: 6 },
          { id: "7", number: 7 },
          { id: "8", number: 8 },
          { id: "9", number: 9 },
        ]);
      });
    });
  });

  describe("isDuplicateKeyError", () => {
    it("returns false for non-object inputs", () => {
      expect(isDuplicateKeyError(null)).toBe(false);
      expect(isDuplicateKeyError(undefined)).toBe(false);
      expect(isDuplicateKeyError("E11000")).toBe(false);
      expect(isDuplicateKeyError(11000)).toBe(false);
      expect(isDuplicateKeyError(false)).toBe(false);
    });

    it("returns true for top-level code 11000", () => {
      expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    });

    it("returns false for other top-level codes", () => {
      expect(isDuplicateKeyError({ code: 11001 })).toBe(false);
      expect(isDuplicateKeyError({ code: 0 })).toBe(false);
      expect(isDuplicateKeyError({ code: "11000" })).toBe(false);
    });

    it("returns true when any writeErrors entry has code 11000", () => {
      expect(
        isDuplicateKeyError({
          writeErrors: [{ code: 11001 }, { code: 11000 }],
        }),
      ).toBe(true);
    });

    it("returns false when writeErrors contains only non-duplicate codes", () => {
      expect(
        isDuplicateKeyError({ writeErrors: [{ code: 11001 }, { code: 121 }] }),
      ).toBe(false);
      expect(isDuplicateKeyError({ writeErrors: [] })).toBe(false);
    });

    it("returns true when the message contains 'E11000' as a last-resort fallback", () => {
      expect(
        isDuplicateKeyError({
          message:
            'E11000 duplicate key error collection: growthbook.featurerevisions index: organization_1_featureId_1_version_1 dup key: { organization: "org_1", featureId: "f", version: 369 }',
        }),
      ).toBe(true);
    });

    it("returns false when message does not contain 'E11000'", () => {
      expect(isDuplicateKeyError({ message: "something else broke" })).toBe(
        false,
      );
      expect(isDuplicateKeyError({ message: "" })).toBe(false);
    });

    it("matches real Error instances that carry the E11000 message", () => {
      // Mirror the shape mongoose's MongoServerError actually throws: a plain
      // Error subclass whose `code` is sometimes stripped by wrapping layers
      // but whose `message` is preserved.
      const err = new Error(
        "E11000 duplicate key error collection: growthbook.featurerevisions",
      );
      expect(isDuplicateKeyError(err)).toBe(true);
    });

    it("prefers the code path when both code and a non-matching message are present", () => {
      expect(
        isDuplicateKeyError({ code: 11000, message: "unrelated text" }),
      ).toBe(true);
    });
  });

  describe("createWithVersionRetry", () => {
    function makeDuplicateKeyError(): Error & { code: number } {
      const err = new Error("E11000 duplicate key error") as Error & {
        code: number;
      };
      err.code = 11000;
      return err;
    }

    it("returns the result of the first successful op call", async () => {
      const op = jest.fn().mockResolvedValue("ok");
      await expect(createWithVersionRetry(op)).resolves.toBe("ok");
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("does not retry when op throws a non-duplicate-key error", async () => {
      const err = new Error("validation failed");
      const op = jest.fn().mockRejectedValue(err);
      await expect(createWithVersionRetry(op)).rejects.toBe(err);
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("retries on duplicate-key error and returns the eventual success value", async () => {
      const op = jest
        .fn()
        .mockRejectedValueOnce(makeDuplicateKeyError())
        .mockRejectedValueOnce(makeDuplicateKeyError())
        .mockResolvedValue("ok");
      await expect(createWithVersionRetry(op)).resolves.toBe("ok");
      expect(op).toHaveBeenCalledTimes(3);
    });

    it("gives up after 5 attempts and throws the last duplicate-key error", async () => {
      // Use distinguishable errors per attempt so we can assert the LAST one
      // is the one that propagates (not the first).
      const errs = Array.from({ length: 5 }, (_, i) => {
        const e = new Error(`E11000 attempt ${i}`) as Error & {
          code: number;
        };
        e.code = 11000;
        return e;
      });
      const op = jest.fn();
      errs.forEach((e) => op.mockRejectedValueOnce(e));

      await expect(createWithVersionRetry(op)).rejects.toBe(errs[4]);
      expect(op).toHaveBeenCalledTimes(5);
    });

    it("re-throws non-duplicate-key errors raised after one or more duplicate-key retries", async () => {
      const fatal = new Error("connection lost");
      const op = jest
        .fn()
        .mockRejectedValueOnce(makeDuplicateKeyError())
        .mockRejectedValueOnce(fatal);
      await expect(createWithVersionRetry(op)).rejects.toBe(fatal);
      expect(op).toHaveBeenCalledTimes(2);
    });
  });
});
