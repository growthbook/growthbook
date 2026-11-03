import React, { ReactNode } from "react";
import { CustomField } from "shared/types/custom-fields";
import Markdown from "@/components/Markdown/Markdown";
import { DataListItem } from "@/ui/DataList";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import {
  isCustomFieldBooleanTrue,
  toCustomFieldBooleanString,
} from "@/services/customFields";

function getMultiSelectValue(value: string) {
  try {
    return JSON.parse(value).join(", ");
  } catch (e) {
    return value;
  }
}

/** Shared by the detail view and the attributes table so the two can't drift. */
export function renderCustomFieldValue(
  field: CustomField,
  value: unknown,
): ReactNode {
  if (customFieldValueToText(field, value).trim() === "") {
    return <Text color="text-mid">--</Text>;
  }

  const stringValue =
    typeof value === "boolean"
      ? toCustomFieldBooleanString(value)
      : String(value ?? "");

  switch (field.type) {
    case "multiselect":
      return getMultiSelectValue(stringValue);
    case "markdown":
      return <Markdown>{stringValue}</Markdown>;
    case "textarea":
      return <div style={{ whiteSpace: "pre-wrap" }}>{stringValue}</div>;
    case "url":
      return (
        <Link href={stringValue} target="_blank" rel="noreferrer">
          {stringValue}
        </Link>
      );
    case "boolean":
      return isCustomFieldBooleanTrue(value) ? "yes" : "no";
    case "date":
      return new Date(stringValue).toLocaleDateString();
    case "datetime":
      return new Date(stringValue).toLocaleString();
    case "text":
    case "enum":
    case "number":
      return stringValue;
    default: {
      const exhaustiveCheck: never = field.type;
      return exhaustiveCheck;
    }
  }
}

// Limit URLs to 3 lines if they are too long
const urlClamp: React.CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  overflow: "hidden",
};

/** DataList rows for a set of fields, so no surface renders them differently. */
export function customFieldDataListItems(
  fields: CustomField[],
  values: Record<string, unknown> | undefined,
): DataListItem[] {
  return fields.map((f) => {
    const raw = values?.[f.id] ?? "";
    const value = renderCustomFieldValue(f, raw);
    return {
      label: f.name,
      value:
        f.type === "url" ? (
          <span style={urlClamp} title={customFieldValueToText(f, raw)}>
            {value}
          </span>
        ) : (
          value
        ),
      tooltip: f.description,
    };
  });
}

/**
 * Value shape for a useSearch `searchTermFilters` accessor. Multiselect returns
 * an array so `surface:ios` matches one of several values — the default filter
 * operator compares for equality, so a joined string would never match.
 */
export function customFieldFilterValue(
  field: CustomField,
  value: unknown,
): string | string[] {
  if (field.type === "multiselect") {
    const raw = String(value ?? "");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      // Fall through to the comma-separated form.
    }
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return customFieldValueToText(field, value);
}

/** Plain-text form of the same value, for search indexing and tooltips. */
export function customFieldValueToText(
  field: CustomField,
  value: unknown,
): string {
  const stringValue =
    typeof value === "boolean"
      ? toCustomFieldBooleanString(value)
      : String(value ?? "");
  if (field.type === "multiselect") return getMultiSelectValue(stringValue);
  if (field.type === "boolean") {
    return stringValue === ""
      ? ""
      : isCustomFieldBooleanTrue(value)
        ? "yes"
        : "no";
  }
  return stringValue;
}
