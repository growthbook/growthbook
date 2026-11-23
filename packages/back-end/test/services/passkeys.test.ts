import { resolveRelyingPartyId } from "back-end/src/services/passkeys";

describe("resolveRelyingPartyId", () => {
  it("defaults to the APP_ORIGIN hostname", () => {
    expect(resolveRelyingPartyId("", "https://gb.example.com")).toBe(
      "gb.example.com",
    );
    expect(resolveRelyingPartyId("", "http://localhost:3000")).toBe(
      "localhost",
    );
  });

  it("accepts the app's own domain or a parent domain", () => {
    expect(
      resolveRelyingPartyId("gb.example.com", "https://gb.example.com"),
    ).toBe("gb.example.com");
    expect(resolveRelyingPartyId("Example.com", "https://gb.example.com")).toBe(
      "example.com",
    );
  });

  it("rejects a domain the app isn't on", () => {
    expect(() =>
      resolveRelyingPartyId("other.com", "https://gb.example.com"),
    ).toThrow("must be gb.example.com or a parent domain");
    // A shared suffix isn't enough, it has to be a whole label
    expect(() =>
      resolveRelyingPartyId("example.com", "https://gb.badexample.com"),
    ).toThrow("must be gb.badexample.com or a parent domain");
  });

  it("rejects an APP_ORIGIN that isn't a full URL", () => {
    expect(() => resolveRelyingPartyId("", "gb.example.com")).toThrow(
      "APP_ORIGIN must be a full URL",
    );
  });
});
