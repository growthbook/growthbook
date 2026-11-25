import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";

type FieldData = {
  type: string;
  description: string;
  details: string;
  enum?: string[];
  lengthRange?: [number | undefined, number | undefined];
  valueRange?: [number | undefined, number | undefined];
};

type FieldInfo = FieldData & {
  key: string;
  required?: boolean;
};

type SchemaSummary =
  | { kind: "fields"; description: MessageDescriptor; fields: FieldInfo[] }
  | { kind: "primitive"; isArray: boolean; field: FieldData };

export default function JSONSchemaDescription({
  jsonSchema,
}: {
  jsonSchema: unknown;
}) {
  const { t, i18n } = useLingui();
  const summary = getJSONSchemaSummary(jsonSchema);
  if (!summary) return null;

  if (summary.kind === "primitive") {
    const { field, isArray } = summary;
    const hasExtraDetails =
      !!field.description || (field.details && field.details !== "{}");

    return (
      <div className="d-flex align-items-center">
        <div className="mr-2">
          {getPrimitiveDescription(field, isArray, i18n)}
        </div>
        {hasExtraDetails ? (
          <Tooltip
            body={
              <div>
                {field.description && (
                  <div className="bg-light p-2 mb-1 border">
                    {field.description}
                  </div>
                )}
                {field.details && field.details !== "{}" && (
                  <div>
                    <Trans>Other Settings:</Trans>
                    <Code language="json" code={field.details} />
                  </div>
                )}
              </div>
            }
            tipMinWidth="300px"
          >
            <GBInfo />
          </Tooltip>
        ) : null}
      </div>
    );
  }

  return (
    <div className="d-flex align-items-center">
      <div className="mr-2">{i18n._(summary.description)}</div>
      {summary.fields.map((field) => {
        const fieldKey = field.key;
        const fieldType = field.type;
        const requiredText = field.required ? t`yes` : t`no`;
        const valueMin = field.valueRange?.[0] ?? "-";
        const valueMax = field.valueRange?.[1] ?? "-";
        const lengthMin = field.lengthRange?.[0] ?? "-";
        const lengthMax = field.lengthRange?.[1] ?? "-";
        return (
          <div key={field.key} className="mr-2 bg-light px-2 border rounded">
            <div>
              <Tooltip
                body={
                  <div>
                    {field.key ? (
                      <div className="mb-1">
                        <Trans>
                          Property: <strong>{fieldKey}</strong>
                        </Trans>
                      </div>
                    ) : null}
                    <div className="mb-1">
                      <Trans>
                        Type: <strong>{fieldType}</strong>
                      </Trans>
                    </div>
                    {field.required !== undefined ? (
                      <div className="mb-1">
                        <Trans>
                          Required: <strong>{requiredText}</strong>
                        </Trans>
                      </div>
                    ) : (
                      ""
                    )}
                    {field.valueRange && (
                      <div className="mb-1">
                        <Trans>
                          Value: Between <strong>{valueMin}</strong> and{" "}
                          <strong>{valueMax}</strong>
                        </Trans>
                      </div>
                    )}
                    {field.lengthRange && (
                      <div className="mb-1">
                        <Trans>
                          Length: Between <strong>{lengthMin}</strong> and{" "}
                          <strong>{lengthMax}</strong>
                        </Trans>
                      </div>
                    )}
                    {field.enum && field.enum.length > 0 && (
                      <div className="mb-1">
                        <Trans>One of:</Trans>{" "}
                        {field.enum.map((e) => (
                          <span className="px-1 border bg-light mr-1" key={e}>
                            {e}
                          </span>
                        ))}
                      </div>
                    )}
                    {field.description && (
                      <div className="bg-light p-2 mb-1 border">
                        {field.description}
                      </div>
                    )}
                    {field.details && field.details !== "{}" && (
                      <div>
                        <Trans>Other Settings:</Trans>
                        <Code language="json" code={field.details} />
                      </div>
                    )}
                  </div>
                }
                tipMinWidth="300px"
              >
                <strong>{field.key}</strong> <GBInfo />
              </Tooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// "Value is one of "ON", "OFF"" / "Value is a float between 0 and 24"
function getPrimitiveDescription(
  field: FieldData,
  isArray: boolean,
  i18n: I18n,
): string {
  // The noun is the schema's type keyword, so it stays untranslated.
  const noun = field.type === "number" ? "float" : field.type;
  const constraint = getConstraintText(field, i18n);

  if (isArray) {
    if (noun === "unknown") {
      return constraint
        ? i18n._(msg`Value is an array of items, each ${constraint}`)
        : i18n._(msg`Value is an array of items`);
    }
    return constraint
      ? i18n._(msg`Value is an array of ${noun}s, each ${constraint}`)
      : i18n._(msg`Value is an array of ${noun}s`);
  }

  if (field.enum && field.enum.length > 0) {
    const values = field.enum.join(", ");
    return i18n._(msg`Value is one of ${values}`);
  }

  if (noun === "unknown") {
    return i18n._(msg`Value is an unknown type`);
  }

  if (/^[aeiou]/i.test(noun)) {
    return constraint
      ? i18n._(msg`Value is an ${noun} ${constraint}`)
      : i18n._(msg`Value is an ${noun}`);
  }
  return constraint
    ? i18n._(msg`Value is a ${noun} ${constraint}`)
    : i18n._(msg`Value is a ${noun}`);
}

function getConstraintText(field: FieldData, i18n: I18n): string {
  if (field.enum && field.enum.length > 0) {
    const values = field.enum.join(", ");
    return i18n._(msg`one of ${values}`);
  }
  if (field.valueRange) {
    const [min, max] = field.valueRange;
    if (min !== undefined && max !== undefined) {
      return i18n._(msg`between ${min} and ${max}`);
    }
    if (min !== undefined) return i18n._(msg`of at least ${min}`);
    if (max !== undefined) return i18n._(msg`of at most ${max}`);
  }
  if (field.lengthRange) {
    const [min, max] = field.lengthRange;
    if (min !== undefined && max !== undefined) {
      return i18n._(msg`between ${min} and ${max} characters long`);
    }
    if (min !== undefined) return i18n._(msg`at least ${min} characters long`);
    if (max !== undefined) return i18n._(msg`at most ${max} characters long`);
  }
  return "";
}

function getFieldData(schema: unknown): FieldData {
  if (!schema || typeof schema !== "object") {
    return {
      type: "unknown",
      description: "",
      details: "",
    };
  }

  const {
    type,
    description,
    enum: values,
    minimum,
    maximum,
    minLength,
    maxLength,
    multipleOf,
    format,
    ...otherDetails
  } = schema as {
    type?: string;
    description?: string;
    enum?: unknown[];
    minimum?: unknown;
    maximum?: unknown;
    minLength?: number;
    maxLength?: number;
    multipleOf?: number;
    format?: string;
    [key: string]: unknown;
  };

  let typeStr = type + "";
  if (multipleOf) {
    if (typeStr === "number" && multipleOf === 1) {
      typeStr = "integer";
    } else {
      otherDetails["multipleOf"] = multipleOf;
    }
  }

  if (format && (format !== "number" || typeStr !== "integer")) {
    otherDetails["format"] = format;
  }

  const min = typeof minimum === "number" ? minimum : undefined;
  const max = typeof maximum === "number" ? maximum : undefined;
  if (minimum !== undefined && min === undefined) {
    otherDetails["minimum"] = minimum;
  }
  if (maximum !== undefined && max === undefined) {
    otherDetails["maximum"] = maximum;
  }

  return {
    type: typeStr || "unknown",
    description: (description || "") + "",
    details: JSON.stringify(otherDetails, null, 2),
    enum: values?.length
      ? values.map((v) => (typeof v === "string" ? `"${v}"` : v + ""))
      : undefined,
    valueRange: min !== undefined || max !== undefined ? [min, max] : undefined,
    lengthRange:
      minLength !== undefined || maxLength !== undefined
        ? [minLength, maxLength]
        : undefined,
  };
}

function getJSONSchemaSummary(jsonSchema: unknown): SchemaSummary | null {
  if (!jsonSchema || typeof jsonSchema !== "object") return null;

  if (
    "properties" in jsonSchema &&
    jsonSchema.properties &&
    typeof jsonSchema.properties === "object"
  ) {
    const required = new Set(
      "required" in jsonSchema && Array.isArray(jsonSchema.required)
        ? jsonSchema.required
        : [],
    );
    return {
      kind: "fields",
      description: msg`Value is an object with properties`,
      fields: Object.entries(jsonSchema.properties).map(([key, value]) => ({
        key,
        required: required.has(key),
        ...getFieldData(value),
      })),
    };
  }

  if (
    "items" in jsonSchema &&
    jsonSchema.items &&
    typeof jsonSchema.items === "object" &&
    !Array.isArray(jsonSchema.items)
  ) {
    if (
      "properties" in jsonSchema.items &&
      jsonSchema.items.properties &&
      typeof jsonSchema.items.properties === "object"
    ) {
      const required = new Set(
        "required" in jsonSchema.items &&
        Array.isArray(jsonSchema.items.required)
          ? jsonSchema.items.required
          : [],
      );
      return {
        kind: "fields",
        description: msg`Value is an array of objects with properties`,
        fields: Object.entries(jsonSchema.items.properties).map(
          ([key, value]) => ({
            key,
            required: required.has(key),
            ...getFieldData(value),
          }),
        ),
      };
    }
    return {
      kind: "primitive",
      isArray: true,
      field: getFieldData(jsonSchema.items),
    };
  }

  return {
    kind: "primitive",
    isArray: false,
    field: getFieldData(jsonSchema),
  };
}
