import mongoose from "mongoose";
import { setupApp } from "back-end/test/api/api.setup";
import {
  getConnectionStringWithDeprecatedKeysMigratedForV3to4,
  safeBulkWrite,
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

  describe("safeBulkWrite", () => {
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
        await safeBulkWrite(
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
        await safeBulkWrite(
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
        await safeBulkWrite(
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
    });
  });
});
