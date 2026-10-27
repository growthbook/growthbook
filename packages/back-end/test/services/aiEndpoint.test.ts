import {
  isPublicAddress,
  normalizeAIBaseUrl,
} from "back-end/src/services/aiEndpoint";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
  ])("rejects %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "104.18.32.7", "2606:4700::6810:1"])(
    "accepts %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("rejects things that are not IP addresses", () => {
    expect(isPublicAddress("example.com")).toBe(false);
  });
});

describe("normalizeAIBaseUrl", () => {
  it("treats blank as the provider's own API", () => {
    expect(normalizeAIBaseUrl("  ", { cloud: true })).toEqual({ baseUrl: "" });
  });

  it("trims whitespace and trailing slashes", () => {
    expect(
      normalizeAIBaseUrl(" https://gateway.example.com/openai/v1/// ", {
        cloud: true,
      }),
    ).toEqual({ baseUrl: "https://gateway.example.com/openai/v1" });
  });

  it.each([
    ["not a url"],
    ["ftp://gateway.example.com"],
    ["https://user:pass@gateway.example.com/v1"],
    ["https://gateway.example.com/v1?key=abc"],
    ["https://gateway.example.com/v1#x"],
  ])("rejects %s everywhere", (url) => {
    expect(normalizeAIBaseUrl(url, { cloud: false }).error).toBeTruthy();
    expect(normalizeAIBaseUrl(url, { cloud: true }).error).toBeTruthy();
  });

  it.each([
    ["http://gateway.example.com/v1"],
    ["https://localhost:4000/v1"],
    ["https://litellm/v1"],
    ["https://127.0.0.1/v1"],
    ["https://169.254.169.254/latest"],
    ["https://[::1]/v1"],
    ["https://0x7f.1/v1"],
    ["https://10.0.0.5/v1"],
  ])("rejects %s on Cloud but allows it self-hosted", (url) => {
    expect(normalizeAIBaseUrl(url, { cloud: true }).error).toBeTruthy();
    expect(normalizeAIBaseUrl(url, { cloud: false }).error).toBeUndefined();
  });

  it("allows a public IP on Cloud", () => {
    expect(
      normalizeAIBaseUrl("https://8.8.8.8/v1", { cloud: true }).baseUrl,
    ).toBe("https://8.8.8.8/v1");
  });
});
