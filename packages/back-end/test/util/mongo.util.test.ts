import { getConnectionStringWithDeprecatedKeysMigratedForV3to4 } from "back-end/src/util/mongo.util";

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
});
