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
  | { kind: "fields"; description: string; fields: FieldInfo[] }
  | { kind: "primitive"; isArray: boolean; field: FieldData };

export default function JSONSchemaDescription({
  jsonSchema,
}: {
  jsonSchema: unknown;
}) {
  const summary = getJSONSchemaSummary(jsonSchema);
  if (!summary) return null;

  if (summary.kind === "primitive") {
    const { field, isArray } = summary;
    const hasExtraDetails =
      !!field.description || (field.details && field.details !== "{}");

    return (
      <div className="d-flex align-items-center">
        <div className="mr-2">{getPrimitiveDescription(field, isArray)}</div>
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
                    Other Settings:
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
      <div className="mr-2">{summary.description}</div>
      {summary.fields.map((field) => (
        <div key={field.key} className="mr-2 bg-light px-2 border rounded">
          <div>
            <Tooltip
              body={
                <div>
                  {field.key ? (
                    <div className="mb-1">
                      Property: <strong>{field.key}</strong>
                    </div>
                  ) : null}
                  <div className="mb-1">
                    Type: <strong>{field.type}</strong>
                  </div>
                  {field.required !== undefined ? (
                    <div className="mb-1">
                      Required: <strong>{field.required ? "yes" : "no"}</strong>
                    </div>
                  ) : (
                    ""
                  )}
                  {field.valueRange && (
                    <div className="mb-1">
                      Value: Between{" "}
                      <strong>{field.valueRange[0] ?? "-"}</strong> and{" "}
                      <strong>{field.valueRange[1] ?? "-"}</strong>
                    </div>
                  )}
                  {field.lengthRange && (
                    <div className="mb-1">
                      Length: Between{" "}
                      <strong>{field.lengthRange[0] ?? "-"}</strong> and{" "}
                      <strong>{field.lengthRange[1] ?? "-"}</strong>
                    </div>
                  )}
                  {field.enum && field.enum.length > 0 && (
                    <div className="mb-1">
                      One of:{" "}
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
                      Other Settings:
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
      ))}
    </div>
  );
}

// "Value is one of "ON", "OFF"" / "Value is a float between 0 and 24"
function getPrimitiveDescription(field: FieldData, isArray: boolean): string {
  const noun = field.type === "number" ? "float" : field.type;
  const constraint = getConstraintText(field);

  if (isArray) {
    const itemNoun = noun === "unknown" ? "item" : noun;
    return `Value is an array of ${itemNoun}s${
      constraint ? `, each ${constraint}` : ""
    }`;
  }

  if (field.enum && field.enum.length > 0) {
    return `Value is ${constraint}`;
  }

  if (noun === "unknown") {
    return "Value is an unknown type";
  }

  const article = /^[aeiou]/i.test(noun) ? "an" : "a";
  return `Value is ${article} ${noun}${constraint ? ` ${constraint}` : ""}`;
}

function getConstraintText(field: FieldData): string {
  if (field.enum && field.enum.length > 0) {
    return `one of ${field.enum.join(", ")}`;
  }
  if (field.valueRange) {
    const [min, max] = field.valueRange;
    if (min !== undefined && max !== undefined) {
      return `between ${min} and ${max}`;
    }
    if (min !== undefined) return `of at least ${min}`;
    if (max !== undefined) return `of at most ${max}`;
  }
  if (field.lengthRange) {
    const [min, max] = field.lengthRange;
    if (min !== undefined && max !== undefined) {
      return `between ${min} and ${max} characters long`;
    }
    if (min !== undefined) return `at least ${min} characters long`;
    if (max !== undefined) return `at most ${max} characters long`;
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
      description: "Value is an object with properties",
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
        description: "Value is an array of objects with properties",
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
