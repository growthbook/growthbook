import { BigQuery } from "@google-cloud/bigquery";
import { createBigQueryClient } from "back-end/src/services/bigqueryClient";
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

const connection = {
  projectId: "my-project",
  clientEmail: "test@example.invalid",
  privateKey: "key",
};
const credentials = {
  projectId: "my-project",
  credentials: { client_email: "test@example.invalid", private_key: "key" },
};

describe("Cloud BigQuery endpoints", () => {
  it.each([undefined, "https://bigquery.googleapis.com"])(
    "preserves the standard Google transport without requiring an egress proxy: %s",
    (apiEndpoint) => {
      jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
      const client = createBigQueryClient({ ...connection, apiEndpoint });
      expect(client.interceptors).toEqual([]);
      expect(BigQuery).toHaveBeenCalledWith({ ...credentials, apiEndpoint });
    },
  );

  it("requires HTTPS for custom Cloud endpoints", () => {
    expect(() =>
      createBigQueryClient({
        ...connection,
        apiEndpoint: "http://proxy.example",
      }),
    ).toThrow("must use HTTPS");
    expect(BigQuery).not.toHaveBeenCalled();
  });

  it("fails closed when WEBHOOK_PROXY is missing", () => {
    jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
    expect(() =>
      createBigQueryClient({
        ...connection,
        apiEndpoint: "https://proxy.example/tenant",
      }),
    ).toThrow("require WEBHOOK_PROXY");
    expect(BigQuery).not.toHaveBeenCalled();
  });

  it("normalizes the endpoint once and configures the egress proxy without losing request options", () => {
    const client = createBigQueryClient({
      ...connection,
      apiEndpoint: "https://PROXY.example/tenant/bigquery/v2/bigquery/v2/",
    });
    expect(BigQuery).toHaveBeenCalledWith({
      ...credentials,
      apiEndpoint: "https://proxy.example/tenant/bigquery/v2",
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

  it("never uses ambient credentials, even for auto auth", () => {
    createBigQueryClient({ ...connection, authType: "auto" });
    expect(BigQuery).toHaveBeenCalledWith({
      ...credentials,
      apiEndpoint: undefined,
    });
  });
});

describe("self-hosted BigQuery endpoints", () => {
  beforeEach(() => {
    jest.replaceProperty(secrets, "IS_CLOUD", false);
    jest.replaceProperty(secrets, "WEBHOOK_PROXY", "");
  });

  it("permits private HTTP endpoints without an egress proxy", () => {
    const apiEndpoint = "http://10.0.0.1:8080";
    expect(
      createBigQueryClient({ ...connection, apiEndpoint }).interceptors,
    ).toEqual([]);
    expect(BigQuery).toHaveBeenCalledWith({ ...credentials, apiEndpoint });
  });

  it("uses ambient credentials for auto auth and keeps the endpoint", () => {
    const apiEndpoint = "https://bigquery.europe-west3.rep.googleapis.com";
    createBigQueryClient({ ...connection, authType: "auto", apiEndpoint });
    expect(BigQuery).toHaveBeenCalledWith({ apiEndpoint });
  });
});
