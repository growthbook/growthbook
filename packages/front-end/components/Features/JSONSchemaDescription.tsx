import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";

export default function JSONSchemaDescription({
  jsonSchema,
}: {
  jsonSchema: unknown;
}) {
  const { jsonSchemaDescription, jsonSchemaFields } =
    getJSONSchemaSummary(jsonSchema);

  return (
    <div className="d-flex align-items-center">
      {jsonSchemaDescription ? (
        <div className="mr-2">{jsonSchemaDescription}</div>
      ) : null}
      {jsonSchemaFields.map((field) => (
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
                      <strong>{field.valueRange[0] || "-"}</strong> and{" "}
                      <strong>{field.valueRange[1] || "-"}</strong>
                    </div>
                  )}
                  {field.lengthRange && (
                    <div className="mb-1">
                      Length: Between <strong>{field.lengthRange[0]}</strong>{" "}
                      and <strong>{field.lengthRange[1]}</strong>
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

function getJSONSchemaSummary(jsonSchema: unknown) {
  // Human-readable description of the JSON Schema validation
  let jsonSchemaDescription = "";
  const jsonSchemaFields: {
    key: string;
    required?: boolean;
    type: string;
    description: string;
    details: string;
    enum?: string[];
    lengthRange?: [number, number];
    valueRange?: [string, string];
  }[] = [];
  if (jsonSchema && typeof jsonSchema === "object") {
    const getFieldData = (schema: unknown) => {
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
        maxium?: unknown;
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

      return {
        type: typeStr || "unknown",
        description: (description || "") + "",
        details: JSON.stringify(otherDetails, null, 2),
        enum: values?.length ? values.map((v) => v + "") : undefined,
        valueRange:
          minimum || maximum
            ? ([minimum + "", maximum + ""] as [string, string])
            : undefined,
        lengthRange:
          minLength || maxLength
            ? ([minLength || 0, maxLength || 0] as [number, number])
            : undefined,
      };
    };

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
      Object.entries(jsonSchema.properties).forEach(([key, value]) => {
        jsonSchemaFields.push({
          key,
          required: required.has(key),
          ...getFieldData(value),
        });
      });
      jsonSchemaDescription = "Value is an object with properties";
    } else if (
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
        Object.entries(jsonSchema.items.properties).forEach(([key, value]) => {
          jsonSchemaFields.push({
            key,
            required: required.has(key),
            ...getFieldData(value),
          });
        });
        jsonSchemaDescription = "Value is an array of objects with properties";
      } else {
        jsonSchemaDescription = "Value is an array of";

        const key =
          "type" in jsonSchema.items ? jsonSchema.items.type + "s" : "items";

        jsonSchemaFields.push({
          key: key,
          ...getFieldData(jsonSchema.items),
        });
      }
    } else {
      jsonSchemaDescription = "Value is a";

      const key = "type" in jsonSchema ? jsonSchema.type + "" : "unknown type";

      jsonSchemaFields.push({
        key: key,
        ...getFieldData(jsonSchema),
      });
    }
  }

  return {
    jsonSchemaDescription,
    jsonSchemaFields,
  };
}
