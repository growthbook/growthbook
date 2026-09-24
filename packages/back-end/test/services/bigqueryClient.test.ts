import { BigQuery } from "@google-cloud/bigquery";
import { createBigQueryClient } from "back-end/src/services/bigqueryClient";
import { BadRequestError } from "back-end/src/util/errors";
import * as secrets from "back-end/src/util/secrets";

jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: jest.fn(() => ({ interceptors: [] })),
}));
jest.mock("back-end/src/util/secrets", () => ({
  __esModule: true,
  IS_CLOUD: true,
  WEBHOOK_PROXY: "http://egress-proxy.internal:4750",
}));

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe("Cloud BigQuery endpoints", () => {
  it.each([undefined, "https://bigquery.googleapis.com"])(
    "preserves the standard Google transport without requiring an egress proxy: %s",
    (apiEndpoint) => {
      jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
      const client = createBigQueryClient({ apiEndpoint });
      expect(client.interceptors).toEqual([]);
      expect(BigQuery).toHaveBeenCalledWith({
        apiEndpoint,
      });
    },
  );

  it("requires HTTPS for custom Cloud endpoints", () => {
    expect(() =>
      createBigQueryClient({ apiEndpoint: "http://proxy.example" }),
    ).toThrow("must use HTTPS");
    expect(BigQuery).not.toHaveBeenCalled();
  });

  it("fails closed when WEBHOOK_PROXY is missing", () => {
    jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
    expect(() =>
      createBigQueryClient({ apiEndpoint: "https://proxy.example/tenant" }),
    ).toThrow("require WEBHOOK_PROXY");
    expect(BigQuery).not.toHaveBeenCalled();
  });

  it("normalizes the endpoint once and configures the egress proxy without losing request options", () => {
    const credentials = {
      client_email: "test@example.invalid",
      private_key: "key",
    };
    const client = createBigQueryClient({
      apiEndpoint: "https://PROXY.example/tenant/bigquery/v2/bigquery/v2/",
      projectId: "my-project",
      credentials,
    });
    expect(BigQuery).toHaveBeenCalledWith({
      apiEndpoint: "https://proxy.example/tenant/bigquery/v2",
      projectId: "my-project",
      credentials,
    });
    const request = client.interceptors[0].request;
    if (!request) throw new Error("Missing request interceptor");
    const uri =
      "https://proxy.example/tenant/bigquery/v2/bigquery/v2/projects/my-project/datasets";
    expect(request({ uri, method: "GET" })).toEqual({
      uri,
      method: "GET",
      proxy: secrets.WEBHOOK_PROXY,
    });
  });

  it.each([
    "https://attacker.example/tenant/bigquery/v2/projects/my-project/datasets",
    "http://proxy.example/tenant/bigquery/v2/projects/my-project/datasets",
    "https://proxy.example/other-tenant/bigquery/v2/projects/my-project/datasets",
    "https://proxy.example/tenant/bigquery/v2/../../../admin",
    "https://user:pass@proxy.example/tenant/bigquery/v2/projects/my-project/datasets",
  ])("rejects requests outside the configured endpoint: %s", (uri) => {
    const client = createBigQueryClient({
      apiEndpoint: "https://proxy.example/tenant",
    });
    const request = client.interceptors[0].request;
    if (!request) throw new Error("Missing request interceptor");
    expect(() => request({ uri })).toThrow(BadRequestError);
  });
});

describe("self-hosted BigQuery endpoints", () => {
  it("permits private HTTP endpoints without an egress proxy", () => {
    const apiEndpoint = "http://10.0.0.1:8080";
    jest.replaceProperty(secrets, "IS_CLOUD", false);
    jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
    expect(createBigQueryClient({ apiEndpoint }).interceptors).toEqual([]);
    expect(BigQuery).toHaveBeenCalledWith({ apiEndpoint });
  });
});
