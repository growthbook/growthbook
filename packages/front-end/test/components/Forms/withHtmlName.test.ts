import { describe, expect, it, vi } from "vitest";
import type { UseFormRegisterReturn } from "react-hook-form";
import {
  eventForRegisteredName,
  shouldDisableNameAutofill,
  withHtmlName,
} from "@/components/Forms/withHtmlName";

function fakeRegistration(
  overrides: Partial<UseFormRegisterReturn> = {},
): UseFormRegisterReturn {
  return {
    name: "name",
    onChange: vi.fn(async () => {}),
    onBlur: vi.fn(async () => {}),
    ref: vi.fn(),
    ...overrides,
  };
}

describe("shouldDisableNameAutofill", () => {
  it("disables contact autofill for resource name fields", () => {
    expect(shouldDisableNameAutofill("name", undefined)).toBe(true);
    expect(shouldDisableNameAutofill("name", "off")).toBe(true);
  });

  it("keeps autofill when the caller passes an autocomplete token", () => {
    expect(shouldDisableNameAutofill("name", "name")).toBe(false);
    expect(shouldDisableNameAutofill("email", undefined)).toBe(false);
  });
});

describe("eventForRegisteredName", () => {
  it("rewrites the DOM name back to the registered field name", () => {
    expect(
      eventForRegisteredName(
        {
          type: "change",
          target: {
            name: "resourceTitle",
            type: "text",
            value: "Checkout CTA",
          },
        },
        "name",
      ),
    ).toEqual({
      type: "change",
      target: { name: "name", type: "text", value: "Checkout CTA" },
    });
  });
});

describe("withHtmlName", () => {
  it("sets the DOM name and forwards events under the registered field name", async () => {
    const onChange = vi.fn(async () => {});
    const onBlur = vi.fn(async () => {});
    const registration = fakeRegistration({ onChange, onBlur });

    const result = withHtmlName(registration, "experimentTitle");

    expect(result.name).toBe("experimentTitle");
    expect(result.ref).toBe(registration.ref);

    await result.onChange({
      type: "change",
      target: { name: "experimentTitle", type: "text", value: "Checkout CTA" },
    });
    expect(onChange).toHaveBeenCalledWith({
      type: "change",
      target: { name: "name", type: "text", value: "Checkout CTA" },
    });

    await result.onBlur({
      type: "blur",
      target: { name: "experimentTitle", type: "text", value: "Checkout CTA" },
    });
    expect(onBlur).toHaveBeenCalledWith({
      type: "blur",
      target: { name: "name", type: "text", value: "Checkout CTA" },
    });
  });
});
