import { BigQuery } from "@google-cloud/bigquery";
import { ensureEventForwarderBigQueryTables } from "back-end/src/services/eventForwarder/bigquery";

const mockDataset = {
  id: "events",
  table: jest.fn(() => ({ exists: jest.fn(async () => [true]) })),
};
jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: jest.fn(() => ({
    interceptors: [],
    dataset: jest.fn(() => mockDataset),
  })),
}));
jest.mock("back-end/src/util/secrets", () => ({
  __esModule: true,
  IS_CLOUD: true,
  WEBHOOK_PROXY: "http://egress-proxy.internal:4750",
}));

it("creates tables through the data source endpoint with the Event Forwarder's service account", async () => {
  await ensureEventForwarderBigQueryTables({
    datasourceParams: {
      authType: "json",
      apiEndpoint: "https://proxy.example/tenant",
      projectId: "datasource-project",
      clientEmail: "datasource@example.invalid",
      privateKey: "datasource-key",
      defaultProject: "",
      defaultDataset: "",
    },
    projectId: "sink-project",
    dataset: "events",
    tablePrefix: "gb",
    serviceAccountKey: JSON.stringify({
      project_id: "key-project",
      client_email: "forwarder@example.invalid",
      private_key: "forwarder-key",
    }),
  });

  expect(BigQuery).toHaveBeenCalledWith({
    apiEndpoint: "https://proxy.example/tenant",
    projectId: "key-project",
    credentials: {
      client_email: "forwarder@example.invalid",
      private_key: "forwarder-key",
    },
  });
  const client = jest.mocked(BigQuery).mock.results[0].value;
  expect(client.interceptors).toHaveLength(1);
  expect(client.dataset).toHaveBeenCalledWith("events", {
    projectId: "sink-project",
  });
});
