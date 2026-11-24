import { describe, expect, it } from "vitest";
import {
  headerSecretKey,
  withHeaderSecret,
} from "@/components/EventWebHooks/datadog";

describe("headerSecretKey", () => {
  it("reads a single secret reference, in any header case or spacing", () => {
    expect(headerSecretKey({ "dd-api-key": "{{DD_KEY}}" }, "DD-API-KEY")).toBe(
      "DD_KEY",
    );
    expect(
      headerSecretKey({ "DD-API-KEY": "{{ DD_KEY }}" }, "DD-API-KEY"),
    ).toBe("DD_KEY");
  });

  it("ignores literal values and mixed text", () => {
    expect(headerSecretKey({ "DD-API-KEY": "abc123" }, "DD-API-KEY")).toBe("");
    expect(
      headerSecretKey({ "DD-API-KEY": "Bearer {{ DD_KEY }}" }, "DD-API-KEY"),
    ).toBe("");
  });
});

describe("withHeaderSecret", () => {
  it("replaces the header whatever its case, keeping the others", () => {
    expect(
      JSON.parse(
        withHeaderSecret(
          JSON.stringify({ "dd-api-key": "abc123", "X-Team": "web" }),
          "DD-API-KEY",
          "DD_KEY",
        ),
      ),
    ).toEqual({ "X-Team": "web", "DD-API-KEY": "{{ DD_KEY }}" });
  });
});
