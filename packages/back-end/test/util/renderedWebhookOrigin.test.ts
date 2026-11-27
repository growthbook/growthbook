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
