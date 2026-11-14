import {
  flagImportSourceKey,
  redactFlagImportRequest,
  redactFlagImportToken,
} from "back-end/src/util/flagImports.util";

describe("flagImportSourceKey", () => {
  it("keeps an IPv4 address as it is", () => {
    expect(flagImportSourceKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("reads an IPv4 address mapped into IPv6", () => {
    expect(flagImportSourceKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("counts every address in an IPv6 /64 as one sender", () => {
    const a = flagImportSourceKey("2001:db8:12:34:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:db8:12:34::/64");
    expect(flagImportSourceKey("2001:0db8:0012:0034::1")).toBe(a);
    expect(flagImportSourceKey("2001:db8:12:35::1")).not.toBe(a);
  });

  it("fills in the zeros a short IPv6 address leaves out", () => {
    expect(flagImportSourceKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(flagImportSourceKey("::1")).toBe("0:0:0:0::/64");
    expect(flagImportSourceKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("has no key for a missing address", () => {
    expect(flagImportSourceKey(undefined)).toBe("");
  });
});

describe("redactFlagImportToken", () => {
  const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

  it("takes the token out of every flag-import path", () => {
    expect(redactFlagImportToken(`/api/v1/flag-imports/${token}`)).toBe(
      "/api/v1/flag-imports/[token]",
    );
    expect(
      redactFlagImportToken(`/api/v1/flag-imports/${token}/claim?x=1`),
    ).toBe("/api/v1/flag-imports/[token]/claim?x=1");
  });

  it("leaves other paths alone", () => {
    expect(redactFlagImportToken("/api/v1/flag-imports?name=acme")).toBe(
      "/api/v1/flag-imports?name=acme",
    );
    expect(redactFlagImportToken("/api/v2/features/newCheckout")).toBe(
      "/api/v2/features/newCheckout",
    );
  });
});

describe("redactFlagImportRequest", () => {
  const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

  it("takes the token out of the path and the params of a logged request", () => {
    expect(
      redactFlagImportRequest({
        method: "POST",
        url: `/api/v1/flag-imports/${token}/import`,
        params: { token },
        headers: { host: "api.growthbook.io" },
      }),
    ).toEqual({
      method: "POST",
      url: "/api/v1/flag-imports/[token]/import",
      params: { token: "[token]" },
      headers: { host: "api.growthbook.io" },
    });
  });

  it("leaves every other request as it was", () => {
    const req = {
      url: "/api/v1/oauth/token",
      params: { token: "something-else" },
    };
    expect(redactFlagImportRequest(req)).toEqual({
      url: "/api/v1/oauth/token",
      params: { token: "something-else" },
    });
    expect(redactFlagImportRequest({})).toEqual({});
  });
});
