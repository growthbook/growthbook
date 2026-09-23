import { vi } from "vitest";

const { makeModuleStub } = vi.hoisted(() => {
  // Preserve the callable/constructible driver stubs without loading their SDKs.
  const handler: ProxyHandler<object> = {
    get(target, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (prop === "__esModule") return true;
      if (!Reflect.has(target, prop)) Reflect.set(target, prop, makeStub());
      return Reflect.get(target, prop);
    },
    apply: () => makeStub(),
    construct: () => makeStub(),
  };
  function makeStub(): object {
    return new Proxy(function stub() {}, handler);
  }
  return { makeModuleStub: () => new Proxy({}, handler) };
});

vi.mock("googleapis", () => makeModuleStub());
vi.mock("@sentry/node", () => makeModuleStub());
vi.mock("stripe", () => makeModuleStub());
vi.mock("openid-client", () => makeModuleStub());
vi.mock("jwks-rsa", () => makeModuleStub());
vi.mock("ai", () => makeModuleStub());
vi.mock("openai", () => makeModuleStub());
vi.mock("@ai-sdk/anthropic", () => makeModuleStub());
vi.mock("@ai-sdk/google", () => makeModuleStub());
vi.mock("@ai-sdk/mistral", () => makeModuleStub());
vi.mock("@ai-sdk/openai", () => makeModuleStub());
vi.mock("@ai-sdk/xai", () => makeModuleStub());
vi.mock("@dqbd/tiktoken", () => makeModuleStub());
vi.mock("tiktoken", () => makeModuleStub());
vi.mock("proxy-agent", () => makeModuleStub());
vi.mock("kerberos", () => makeModuleStub());
vi.mock("@google-cloud/bigquery", () => makeModuleStub());
vi.mock("@google-cloud/storage", () => makeModuleStub());
vi.mock("@aws-sdk/client-athena", () => makeModuleStub());
vi.mock("@aws-sdk/client-sts", () => makeModuleStub());
vi.mock("@aws-sdk/client-s3", () => makeModuleStub());
vi.mock("@aws-sdk/client-cloudwatch", () => makeModuleStub());
vi.mock("@aws-sdk/credential-providers", () => makeModuleStub());
vi.mock("@aws-sdk/s3-request-presigner", () => makeModuleStub());
vi.mock("@aws-sdk/s3-presigned-post", () => makeModuleStub());
vi.mock("@databricks/sql", () => makeModuleStub());
vi.mock("@clickhouse/client", () => makeModuleStub());
vi.mock("presto-client", () => makeModuleStub());
vi.mock("mysql2", () => makeModuleStub());
vi.mock("mysql2/promise", () => makeModuleStub());
vi.mock("mssql", () => makeModuleStub());

// Snowflake's CustomGC and the Python pool must not leave open handles.
vi.mock("snowflake-sdk", () => {
  const sdk = { createConnection: vi.fn(), configure: vi.fn() };
  return { default: sdk, ...sdk };
});
vi.mock("back-end/src/services/python", () => ({
  statsServerPool: { acquire: vi.fn(), release: vi.fn() },
}));
