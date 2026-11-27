import {
  renderedWebhookOrigin,
  secretsReplacer,
} from "back-end/src/util/secrets";

describe("secretsReplacer", () => {
  const apply = secretsReplacer({
    TOKEN: "t&1",
    "my-key": "hyphen",
    "API KV": "space",
  });

  it("substitutes every supported reference form", () => {
    expect(
      apply("{{TOKEN}} {{ TOKEN }} {{[TOKEN]}} {{my-key}} {{ API KV }}"),
    ).toBe("t&1 t&1 t&1 hyphen space");
    expect(apply("?t={{ TOKEN }}", { encode: encodeURIComponent })).toBe(
      "?t=t%261",
    );
    expect(apply({ "X-{{my-key}}": "Bearer {{TOKEN}}" })).toEqual({
      "X-hyphen": "Bearer t&1",
    });
  });

  it("throws on a reference that isn't a known secret", () => {
    expect(() => apply("{{ NOPE }}")).toThrow('"NOPE" not defined');
    expect(() => apply("{{ constructor }}")).toThrow();
  });

  it("runs no template syntax", () => {
    [
      "{{!-- comment --}}",
      "{{#if TOKEN}}a{{/if}}",
      '{{lookup this "TOKEN"}}',
      "{{log TOKEN}}",
    ].forEach((template) => expect(() => apply(template)).toThrow());
    expect(apply("{{{TOKEN}}}")).toBe("{t&1}");
  });
});

describe("renderedWebhookOrigin", () => {
  it("can't be pointed away from the typed host by a template comment", () => {
    expect(
      renderedWebhookOrigin(
        "https://{{!--@allowed.host/--}}attacker.example/?s={{ SECRET }}",
        { SECRET: "s" },
      ),
    ).toBe(null);
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
