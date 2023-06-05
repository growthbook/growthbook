import { getConnectionStringWithDeprecatedKeysMigratedForV3to4 } from "../../src/util/mongo.util";

describe("mongo utils", () => {
  describe("getConnectionStringWithDeprecatedKeysMigratedForV3to4", () => {
    it("returns the original string when no replacements are required", () => {
      const input =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin";
      const expected =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin";

      const {
        url,
        success,
        remapped,
      } = getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

      expect(url).toEqual(expected);
      expect(success).toBe(true);
      expect(remapped).toEqual([]);
    });

    it("returns a modified URI when one of the properties needs to be migrated", () => {
      const input =
        "mongodb://root:password@localhost:27017/growthbook?poolSize=50";
      const expected =
        "mongodb://root:password@localhost:27017/growthbook?maxPoolSize=50";

      const {
        url,
        success,
        remapped,
      } = getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

      expect(url).toEqual(expected);
      expect(success).toBe(true);
      expect(remapped).toEqual(["poolSize"]);
    });

    it("returns a modified URI when several properties need to be migrated", () => {
      const input =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin&poolSize=50&wtimeout=123456&appname=foobar&tlsinsecure=true";
      const expected =
        "mongodb://root:password@localhost:27017/growthbook?authSource=admin&maxPoolSize=50&tlsInsecure=true&wtimeoutMS=123456&appName=foobar";

      const {
        url,
        success,
        remapped,
      } = getConnectionStringWithDeprecatedKeysMigratedForV3to4(input);

      expect(url).toEqual(expected);
      expect(success).toBe(true);
      expect(remapped).toEqual([
        "poolSize",
        "tlsinsecure",
        "wtimeout",
        "appname",
      ]);
    });
  });
});
