import { getProxySettings } from "../../src/services/snowflake";

describe("snowflake", () => {
  describe("getProxySettings", () => {
    it("should return an empty object for proxy settings if the uri is not set", () => {
      const proxySettings = getProxySettings(undefined);

      expect(proxySettings).toEqual({});
    });

    it("should return a parsed protocol, host, and port for a url", () => {
      const proxySettings = getProxySettings(
        "http://local.snowflake.proxy:8000"
      );

      expect(proxySettings).toEqual({
        proxyProtocol: "http:",
        proxyHost: "local.snowflake.proxy",
        proxyPort: 8000,
      });
    });

    it("should return a parsed protocol, host, port, username, and password for a url", () => {
      const proxySettings = getProxySettings(
        "http://snowflakeUser:snowflakePassword@local.snowflake.proxy:8000"
      );

      expect(proxySettings).toEqual({
        proxyProtocol: "http:",
        proxyHost: "local.snowflake.proxy",
        proxyPort: 8000,
        proxyUser: "snowflakeUser",
        proxyPassword: "snowflakePassword",
      });
    });

    it("should return the default port for a parsed https protocol because the snowflake sdk requires a port", () => {
      const proxySettings = getProxySettings("https://local.snowflake.proxy");

      expect(proxySettings).toEqual({
        proxyProtocol: "https:",
        proxyHost: "local.snowflake.proxy",
        proxyPort: 443,
      });
    });

    it("should return the default port for a parsed https protocol when it's specified because nodejs removes it during parsing", () => {
      const proxySettings = getProxySettings(
        "https://local.snowflake.proxy:443"
      );

      expect(proxySettings).toEqual({
        proxyProtocol: "https:",
        proxyHost: "local.snowflake.proxy",
        proxyPort: 443,
      });
    });

    it("should return the specified non-default port for a parsed https protocol", () => {
      const proxySettings = getProxySettings(
        "https://local.snowflake.proxy:8000"
      );

      expect(proxySettings).toEqual({
        proxyProtocol: "https:",
        proxyHost: "local.snowflake.proxy",
        proxyPort: 8000,
      });
    });

    it("should return the default port for a parsed http protocol because the snowflake sdk requires a port", () => {
      const proxySettings = getProxySettings("http://local.snowflake.proxy");

      expect(proxySettings).toEqual({
        proxyProtocol: "http:",
        proxyHost: "local.snowflake.proxy",
        proxyPort: 80,
      });
    });

    it("should return the default port for a parsed http protocol when it's specified because nodejs removes it during parsing", () => {
      const proxySettings = getProxySettings("http://local.snowflake.proxy:80");

      expect(proxySettings).toEqual({
        proxyProtocol: "http:",
        proxyHost: "local.snowflake.proxy",
        proxyPort: 80,
      });
    });

    it("should return the specified non-default port for a parsed http protocol", () => {
      const proxySettings = getProxySettings(
        "http://local.snowflake.proxy:8000"
      );

      expect(proxySettings).toEqual({
        proxyProtocol: "http:",
        proxyHost: "local.snowflake.proxy",
        proxyPort: 8000,
      });
    });
  });
});
