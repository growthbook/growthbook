import {
  parseApiClient,
  truncateUserAgent,
} from "back-end/src/util/api-client.util";

describe("parseApiClient", () => {
  it("identifies first-party clients and their versions", () => {
    expect(
      parseApiClient("growthbook-cli/2.6.0 (go1.24.0; darwin/arm64)"),
    ).toEqual({ client: "cli", clientVersion: "2.6.0" });
    expect(
      parseApiClient("growthbook-mcp/2.1.0 (node v22.1.0; stdio)"),
    ).toEqual({
      client: "mcp",
      clientVersion: "2.1.0",
    });
    expect(parseApiClient("growthbook-skills/1.0.0 (gb-call)")).toEqual({
      client: "skills",
      clientVersion: "1.0.0",
    });
    expect(parseApiClient("growthbook-coderefs/1.4.2")).toEqual({
      client: "coderefs",
      clientVersion: "1.4.2",
    });
  });

  it("identifies the legacy oclif CLI, which sends no platform suffix", () => {
    expect(parseApiClient("growthbook-cli/0.2.5")).toEqual({
      client: "cli",
      clientVersion: "0.2.5",
    });
    // It interpolates npm_package_version, which is only set when the CLI runs
    // via an npm script — so most real traffic from it looks like this.
    expect(parseApiClient("growthbook-cli/undefined")).toEqual({
      client: "cli",
      clientVersion: "undefined",
    });
  });

  it("identifies CLI releases that predate the User-Agent override", () => {
    expect(
      parseApiClient(
        "speakeasy-sdk/go 0.0.1 2.930.0 5.0.1 github.com/growthbook/cli/v2/internal/sdk",
      ),
    ).toEqual({ client: "cli", clientVersion: null });
  });

  it("buckets generic runtimes", () => {
    expect(parseApiClient("curl/8.5.0").client).toBe("curl");
    expect(parseApiClient("python-requests/2.31.0").client).toBe("python");
    expect(parseApiClient("node").client).toBe("node");
    expect(parseApiClient("undici/6.0.0").client).toBe("node");
    expect(parseApiClient("Go-http-client/2.0").client).toBe("go");
    expect(parseApiClient("okhttp/4.12.0").client).toBe("java");
    expect(parseApiClient("PostmanRuntime/7.36.0").client).toBe("postman");
    expect(parseApiClient("Mozilla/5.0 (Macintosh)").client).toBe("browser");
  });

  it("prefers the specific tool over the runtime it is built on", () => {
    // Terraform's Go SDK would otherwise land in the "go" bucket
    expect(
      parseApiClient("Terraform/1.7.0 (+https://www.terraform.io)").client,
    ).toBe("terraform");
    expect(parseApiClient("HashiCorp Terraform/1.7.0").client).toBe(
      "terraform",
    );
  });

  it("separates absent User-Agents from unrecognized ones", () => {
    expect(parseApiClient(undefined).client).toBe("unknown");
    expect(parseApiClient("   ").client).toBe("unknown");
    expect(parseApiClient("acme-internal-tool/3.0").client).toBe("other");
  });

  it("is case-insensitive on the product token", () => {
    expect(parseApiClient("GrowthBook-CLI/2.6.0").client).toBe("cli");
  });

  it("does not match a product token embedded mid-string", () => {
    expect(parseApiClient("evil growthbook-cli/9.9.9").client).toBe("other");
  });

  it("keeps a versionless product token out of the first-party buckets", () => {
    expect(parseApiClient("growthbook-cli/").client).toBe("other");
  });

  it("bounds the version, which is caller-controlled", () => {
    const { client, clientVersion } = parseApiClient(
      `growthbook-cli/${"9".repeat(300)}`,
    );
    expect(client).toBe("cli");
    expect(clientVersion).toHaveLength(64);
  });
});

describe("truncateUserAgent", () => {
  it("bounds the stored value", () => {
    expect(truncateUserAgent("x".repeat(300))).toHaveLength(256);
  });

  it("normalizes empty values away", () => {
    expect(truncateUserAgent(undefined)).toBeUndefined();
    expect(truncateUserAgent("")).toBeUndefined();
  });
});
