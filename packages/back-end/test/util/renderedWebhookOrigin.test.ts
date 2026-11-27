import { renderedWebhookOrigin } from "back-end/src/util/secrets";

describe("renderedWebhookOrigin", () => {
  it("sees through a template comment that hides the real host", () => {
    const url =
      "https://{{!--@allowed.host/--}}attacker.example/?s={{ SECRET }}";
    expect(new URL(url).origin).toBe("https://allowed.host");
    expect(renderedWebhookOrigin(url, { SECRET: "s" })).toBe(
      "https://attacker.example",
    );
  });

  it("resolves a secret in the host, encoded as the request encodes it", () => {
    expect(
      renderedWebhookOrigin("https://{{ HOST }}/hook", { HOST: "a.example" }),
    ).toBe("https://a.example");
    expect(
      renderedWebhookOrigin("https://ok.example/{{ S }}", { S: "@evil/" }),
    ).toBe("https://ok.example");
  });

  it("returns null when the URL can't be rendered", () => {
    expect(renderedWebhookOrigin("https://ok.example/{{ NOPE }}", {})).toBe(
      null,
    );
  });
});

// Handlebars `lookup` doesn't throw on a missing key, even in strict mode, so
// a template can pick its host from whether a secret is present.
it("lets a template change host when a secret is absent", () => {
  const url =
    'https://{{#if (lookup this "BLOCKED")}}allowed.example{{else}}evil.example{{/if}}/';
  expect(renderedWebhookOrigin(url, { BLOCKED: "x" })).toBe(
    "https://allowed.example",
  );
  expect(renderedWebhookOrigin(url, {})).toBe("https://evil.example");
});
