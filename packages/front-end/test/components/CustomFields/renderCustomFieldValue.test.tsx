import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CustomField } from "shared/types/custom-fields";
import { renderCustomFieldValue } from "@/components/CustomFields/renderCustomFieldValue";

const fieldTypes: CustomField["type"][] = [
  "text",
  "textarea",
  "markdown",
  "enum",
  "multiselect",
  "url",
  "number",
  "boolean",
  "date",
  "datetime",
];

function field(type: CustomField["type"]): CustomField {
  return {
    id: "f",
    name: "Field",
    type,
    required: false,
    sections: ["experiment"],
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
}

function shown(type: CustomField["type"], value: unknown): string {
  const { container } = render(
    <>{renderCustomFieldValue(field(type), value)}</>,
  );
  return container.textContent ?? "";
}

describe("renderCustomFieldValue", () => {
  it.each(fieldTypes)("shows -- for an unset %s field", (type) => {
    expect(shown(type, "")).toBe("--");
    expect(shown(type, undefined)).toBe("--");
  });

  it("shows -- for a cleared multiselect", () => {
    expect(shown("multiselect", "[]")).toBe("--");
  });

  it("shows -- for whitespace-only long-form text", () => {
    expect(shown("textarea", " \n\n ")).toBe("--");
    expect(shown("markdown", "\n")).toBe("--");
  });

  it("keeps an explicit false distinct from unset", () => {
    expect(shown("boolean", false)).toBe("no");
    expect(shown("boolean", "false")).toBe("no");
    expect(shown("boolean", "true")).toBe("yes");
  });

  it("renders set values", () => {
    expect(shown("multiselect", '["ios","android"]')).toBe("ios, android");
    expect(shown("textarea", "Line one\nLine two")).toBe("Line one\nLine two");
    expect(shown("text", "First purchase rate")).toBe("First purchase rate");
  });
});
