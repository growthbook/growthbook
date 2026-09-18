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
  it.each([undefined, "", "https://bigquery.googleapis.com"])(
    "preserves the standard Google transport without requiring an egress proxy: %s",
    (apiEndpoint) => {
      jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
      const client = createBigQueryClient({ apiEndpoint });
      expect(client.interceptors).toEqual([]);
      expect(BigQuery).toHaveBeenCalledWith({
        apiEndpoint: apiEndpoint || undefined,
      });
    },
  );

  it.each([
    "https://customer.example",
    "https://sub.proxy.example/tenant",
    "https://proxy.example:8443/tenant",
    "https://proxy.example/other-tenant",
  ])(
    "accepts customer endpoints without operator approval: %s",
    (apiEndpoint) => {
      const client = createBigQueryClient({ apiEndpoint });
      expect(BigQuery).toHaveBeenCalledWith({ apiEndpoint });
      expect(client.interceptors).toHaveLength(1);
    },
  );

  it.each(["https://127.0.0.1", "https://169.254.169.254", "https://[::1]"])(
    "delegates private-destination blocking to the egress proxy: %s",
    (apiEndpoint) => {
      const client = createBigQueryClient({ apiEndpoint });
      const request = client.interceptors[0].request;
      if (!request) throw new Error("Missing request interceptor");
      expect(
        request({
          uri: `${apiEndpoint}/bigquery/v2/projects/my-project/datasets`,
        }),
      ).toEqual(
        expect.objectContaining({
          proxy: secrets.WEBHOOK_PROXY,
          followRedirect: false,
        }),
      );
    },
  );

  it.each([
    "http://proxy.example",
    "http://127.0.0.1",
    "http://bigquery.googleapis.com",
  ])("requires HTTPS: %s", (apiEndpoint) => {
    expect(() => createBigQueryClient({ apiEndpoint })).toThrow(
      "must use HTTPS",
    );
    expect(BigQuery).not.toHaveBeenCalled();
  });

  it("fails closed when WEBHOOK_PROXY is missing", () => {
    jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
    expect(() =>
      createBigQueryClient({ apiEndpoint: "https://proxy.example/tenant" }),
    ).toThrow("require WEBHOOK_PROXY");
    expect(BigQuery).not.toHaveBeenCalled();
  });

  it("uses the egress proxy and rejects redirects for normalized custom endpoints", () => {
    const client = createBigQueryClient({
      apiEndpoint: "https://PROXY.example/tenant/bigquery/v2/",
    });
    expect(BigQuery).toHaveBeenCalledWith({
      apiEndpoint: "https://proxy.example/tenant",
    });
    const request = client.interceptors[0].request;
    if (!request) throw new Error("Missing request interceptor");
    const uri =
      "https://proxy.example/tenant/bigquery/v2/projects/my-project/datasets";
    expect(request({ uri, method: "GET" })).toEqual({
      uri,
      method: "GET",
      proxy: secrets.WEBHOOK_PROXY,
      followRedirect: false,
    });
  });

  it("preserves a proxy prefix ending in /bigquery/v2", () => {
    const client = createBigQueryClient({
      apiEndpoint: "https://proxy.example/tenant/bigquery/v2/bigquery/v2",
    });
    expect(BigQuery).toHaveBeenCalledWith({
      apiEndpoint: "https://proxy.example/tenant/bigquery/v2",
    });
    const request = client.interceptors[0].request;
    if (!request) throw new Error("Missing request interceptor");
    const uri =
      "https://proxy.example/tenant/bigquery/v2/bigquery/v2/projects/my-project/datasets";
    expect(request({ uri })).toEqual({
      uri,
      proxy: secrets.WEBHOOK_PROXY,
      followRedirect: false,
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
  it.each([
    "http://10.0.0.1:8080",
    "https://proxy.internal",
    "http://[::1]:8080",
  ])(
    "permits %s without Cloud restrictions or transport changes",
    (apiEndpoint) => {
      jest.replaceProperty(secrets, "IS_CLOUD", false);
      jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
      expect(createBigQueryClient({ apiEndpoint }).interceptors).toEqual([]);
      expect(BigQuery).toHaveBeenCalledWith({ apiEndpoint });
    },
  );
});

describe("BigQuery project IDs", () => {
  it.each([
    undefined,
    "",
    "my-project",
    "example.com:my-project",
    "123456789012",
    "PROJECT",
    "project_alias",
    "project.alias",
    "project@host",
  ])(
    "leaves project discovery and naming validation to the SDK: %s",
    (projectId) => {
      createBigQueryClient({ projectId });
      expect(BigQuery).toHaveBeenCalledWith({
        projectId,
        apiEndpoint: undefined,
      });
    },
  );
});
