import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { getEventForwarderBigQueryConnectionParams } from "back-end/src/services/eventForwarder/config";

const key = JSON.stringify({
  project_id: "p",
  client_email: "sa@p.iam.gserviceaccount.com",
  private_key: "k",
});
const params = (apiEndpoint?: string) =>
  ({ projectId: "p", apiEndpoint }) as BigQueryConnectionParams;

describe("getEventForwarderBigQueryConnectionParams", () => {
  it("uses the saved key only with the endpoint it was saved for", () => {
    const bound = {
      serviceAccountKey: key,
      serviceAccountKeyEndpoint: "https://proxy.example.com",
    };
    expect(
      getEventForwarderBigQueryConnectionParams(
        params(" https://Proxy.example.com "),
        bound,
      ).privateKey,
    ).toBe("k");
    expect(() =>
      getEventForwarderBigQueryConnectionParams(
        params("https://evil.example.com"),
        bound,
      ),
    ).toThrow("Re-enter the key");
    expect(() =>
      getEventForwarderBigQueryConnectionParams(params(), bound),
    ).toThrow();
  });

  it("binds a key saved for the default endpoint", () => {
    const bound = { serviceAccountKey: key, serviceAccountKeyEndpoint: "" };
    expect(
      getEventForwarderBigQueryConnectionParams(params(), bound).privateKey,
    ).toBe("k");
    expect(() =>
      getEventForwarderBigQueryConnectionParams(
        params("https://evil.example.com"),
        bound,
      ),
    ).toThrow();
  });

  it("keeps a key saved before the binding existed usable anywhere", () => {
    expect(
      getEventForwarderBigQueryConnectionParams(
        params("https://proxy.example.com"),
        { serviceAccountKey: key },
      ).privateKey,
    ).toBe("k");
  });

  it("leaves the params alone when there is no saved key", () => {
    const p = params("https://evil.example.com");
    expect(getEventForwarderBigQueryConnectionParams(p, {})).toBe(p);
  });
});
