import {
  datadogEventsUrl,
  datadogSiteForUrl,
  datadogWebhookProblem,
  getDatadogServiceNames,
} from "../src/util/datadog";

describe("datadogWebhookProblem", () => {
  const headers = { "DD-API-KEY": "{{ DATADOG_API_KEY }}" };

  it("accepts POST with an API key header, in any case", () => {
    expect(datadogWebhookProblem({ method: "POST", headers })).toBeNull();
    expect(
      datadogWebhookProblem({ headers: { "dd-api-key": "abc123" } }),
    ).toBeNull();
  });

  it("refuses other methods", () => {
    expect(datadogWebhookProblem({ method: "PUT", headers })).toBe(
      "Datadog webhooks must use the POST method.",
    );
  });

  it("refuses a missing or blank API key header", () => {
    expect(datadogWebhookProblem({ method: "POST", headers: {} })).toMatch(
      /need a DD-API-KEY header/,
    );
    expect(
      datadogWebhookProblem({ method: "POST", headers: { "DD-API-KEY": " " } }),
    ).toMatch(/need a DD-API-KEY header/);
  });
});

describe("datadogSiteForUrl", () => {
  it("finds the site an intake URL points at, or null for a custom URL", () => {
    expect(datadogSiteForUrl(datadogEventsUrl("datadoghq.eu"))?.id).toBe(
      "datadoghq.eu",
    );
    expect(datadogSiteForUrl("https://proxy.example.com/events")).toBeNull();
  });
});

describe("getDatadogServiceNames", () => {
  it("reads lists, JSON lists and comma-separated text, trimmed, lowercased and deduplicated", () => {
    expect(
      getDatadogServiceNames([
        ["Checkout-API", " checkout-web "],
        '["checkout-api","billing"]',
        "search, ,ads",
        null,
        42,
      ]),
    ).toEqual(["checkout-api", "checkout-web", "billing", "search", "ads"]);
  });
});
