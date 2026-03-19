import { getInitialDataFromJWT } from "back-end/src/services/auth";

describe("getInitialDataFromJWT", () => {
  it("prefers full name claim over given name", () => {
    const result = getInitialDataFromJWT({
      email: "alice@example.com",
      email_verified: true,
      given_name: "Alice",
      name: "Alice Johnson",
      iat: 12345,
      sub: "oidc-sub",
    });

    expect(result).toEqual({
      email: "alice@example.com",
      name: "Alice Johnson",
      verified: true,
      issuedAt: 12345,
      sub: "oidc-sub",
    });
  });

  it("falls back to given name when full name is missing", () => {
    const result = getInitialDataFromJWT({
      email: "alice@example.com",
      email_verified: true,
      given_name: "Alice",
    });

    expect(result).toMatchObject({
      email: "alice@example.com",
      name: "Alice",
      verified: true,
    });
  });
});
