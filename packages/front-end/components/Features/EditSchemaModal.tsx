import { useForm } from "react-hook-form";
import {
  FeatureInterface,
  JSONSchemaDef,
  SchemaField,
  SimpleSchema,
} from "back-end/types/feature";
import React, { useState } from "react";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import {
  getJSONValidator,
  inferSimpleSchemaFromValue,
  simpleToJSONSchema,
} from "shared/util";
import { FaAngleDown, FaAngleRight, FaTimes } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { GBAddCircle } from "@/components/Icons";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

export interface Props {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
}

// TODO: enable this when we have a GUI for entering feature values based on the schema
const SUPPORTS_DEFAULT_VALUES = false;

function EditSchemaField({
  i,
  value,
  inObject,
  onChange,
}: {
  i: number;
  value: SchemaField;
  inObject: boolean;
  onChange: (value: SchemaField) => void;
}) {
  return (
    <div>
      <div className="row">
        {inObject && (
          <div className="col">
            <Field
              label="Property Key"
              value={value.key}
              onChange={(e) => onChange({ ...value, key: e.target.value })}
              required
            />
          </div>
        )}
        <div className="col">
          <SelectField
            label="Type"
            value={value.type}
            onChange={(type) =>
              onChange({ ...value, type: type as SchemaField["type"] })
            }
            sort={false}
            options={[
              {
                value: "string",
                label: "Text String",
              },
              {
                value: "integer",
                label: "Integer",
              },
              {
                value: "float",
                label: "Float (Decimal)",
              },
              {
                value: "boolean",
                label: "Boolean (True/False)",
              },
            ]}
            required
          />
        </div>
      </div>
      <Field
        label="Description"
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
      {inObject && (
        <div className="form-group">
          <Toggle
            id={`schema_required_${i}`}
            value={value.required}
            setValue={(v) => onChange({ ...value, required: v })}
            type="toggle"
          />{" "}
          <label htmlFor={`schema_required_${i}`}>Required</label>
        </div>
      )}
      {value.type !== "boolean" && (
        <>
          <MultiSelectField
            label="Restrict to Specific Values"
            placeholder="(Optional)"
            value={value.enum}
            onChange={(e) => {
              // TODO: validation (e.g. if type === "integer", make sure they are integers)
              onChange({ ...value, enum: e });
            }}
            options={value.enum.map((v) => ({ value: v, label: v }))}
            creatable
          />
          {value.enum.length === 0 && (
            <div className="row">
              <div className="col">
                <Field
                  label={value.type === "string" ? "Min Length" : "Minimum"}
                  value={value.min}
                  max={value.max || undefined}
                  min={value.type === "string" ? 0 : undefined}
                  type="number"
                  step={value.type !== "float" ? 1 : "any"}
                  onChange={(e) =>
                    onChange({ ...value, min: parseInt(e.target.value) })
                  }
                />
              </div>
              <div className="col">
                <Field
                  label={value.type === "string" ? "Max Length" : "Maximum"}
                  value={value.max}
                  type="number"
                  min={value.min || undefined}
                  step={value.type !== "float" ? 1 : "any"}
                  onChange={(e) =>
                    onChange({ ...value, max: parseInt(e.target.value) })
                  }
                />
              </div>
            </div>
          )}
        </>
      )}
      {inObject && SUPPORTS_DEFAULT_VALUES && (
        <>
          {value.type === "boolean" ? (
            <SelectField
              label="Default Value"
              sort={false}
              value={
                ["false", ""].includes(value.default) ? value.default : "true"
              }
              onChange={(v) => onChange({ ...value, default: v })}
              options={[
                {
                  value: "true",
                  label: "True",
                },
                {
                  value: "false",
                  label: "False",
                },
              ]}
              initialOption="No Default"
              required
            />
          ) : value.enum.length > 0 ? (
            <SelectField
              label="Default Value"
              sort={false}
              value={value.default}
              onChange={(v) => onChange({ ...value, default: v })}
              options={value.enum.map((v) => ({ value: v, label: v }))}
              initialOption="No Default"
            />
          ) : (
            <Field
              label="Default Value"
              value={value.default}
              onChange={(e) => onChange({ ...value, default: e.target.value })}
              {...(value.type === "string"
                ? {
                    minLength: value.min,
                    maxLength: value.max,
                  }
                : {
                    type: "number",
                    step: value.type === "float" ? "any" : 1,
                    min: value.min,
                    max: value.max,
                  })}
            />
          )}
        </>
      )}
    </div>
  );
}

function EditSimpleSchema({
  schema,
  setSchema,
}: {
  schema: SimpleSchema;
  setSchema: (schema: SimpleSchema) => void;
}) {
  const [expandedFields, setExpandedFields] = useState(new Set<number>());

  return (
    <div>
      <SelectField
        label="Type"
        value={schema.type}
        sort={false}
        onChange={(type) =>
          setSchema({
            ...schema,
            type: type as SimpleSchema["type"],
          })
        }
        options={[
          {
            value: "object",
            label: "Object",
          },
          {
            value: "object[]",
            label: "Array of Objects",
          },
          {
            value: "primitive",
            label: "Primitive Value (string, number, boolean)",
          },
          {
            value: "primitive[]",
            label: "Array of Primitive Values",
          },
        ]}
        required
      />
      {schema.type === "primitive[]" || schema.type === "primitive" ? (
        <div className="form-group">
          <label>
            {schema.type === "primitive" ? "Primitive Value" : "Array Items"}
          </label>
          <div className="appbox p-3 bg-light">
            <EditSchemaField
              i={0}
              value={
                schema.fields[0] || {
                  key: "",
                  type: "string",
                  required: false,
                  default: "",
                  description: "",
                  enum: [],
                  min: 0,
                  max: 256,
                }
              }
              inObject={false}
              onChange={(newValue) => {
                setSchema({
                  ...schema,
                  fields: [newValue],
                });
              }}
            />
          </div>
        </div>
      ) : (
        <div className="form-group">
          <label>Object Properties</label>
          <div>
            {schema.fields.map((field, i) => (
              <div className="appbox mb-2 bg-light" key={i}>
                <div className="d-flex align-items-center">
                  <h3
                    className="mb-0"
                    onClick={(e) => {
                      e.preventDefault();
                      const newExpandedFields = new Set(expandedFields);
                      if (expandedFields.has(i)) {
                        newExpandedFields.delete(i);
                      } else {
                        newExpandedFields.add(i);
                      }
                      setExpandedFields(newExpandedFields);
                    }}
                  >
                    <button className="btn btn-link">
                      {expandedFields.has(i) ? (
                        <FaAngleDown />
                      ) : (
                        <FaAngleRight />
                      )}
                    </button>
                    <span
                      style={{ verticalAlign: "middle" }}
                      className="cursor-pointer"
                    >
                      {field.key ? field.key : "New Property"}
                    </span>
                  </h3>
                  {!expandedFields.has(i) && (
                    <div className="mx-2 text-muted">
                      {field.type}{" "}
                      {field.type !== "boolean" && field.enum.length ? (
                        <>
                          (One of:{" "}
                          <OverflowText maxWidth={400}>
                            {field.enum.map((v) => (
                              <span
                                className="badge badge-light border mr-1"
                                key={v}
                              >
                                {v}
                              </span>
                            ))}
                          </OverflowText>
                          )
                        </>
                      ) : field.type === "string" ? (
                        `(${field.min} - ${field.max} chars)`
                      ) : ["integer", "float"].includes(field.type) ? (
                        `(${field.min} to ${field.max})`
                      ) : (
                        ""
                      )}
                      {!field.required ? " (Optional)" : ""}
                    </div>
                  )}
                  <button
                    className="btn btn-link text-secondary ml-auto"
                    title="Delete Property"
                    onClick={(e) => {
                      e.preventDefault();
                      const newFields = [...schema.fields];
                      newFields.splice(i, 1);
                      setSchema({
                        ...schema,
                        fields: newFields,
                      });
                    }}
                  >
                    <FaTimes />
                  </button>
                </div>
                {expandedFields.has(i) ? (
                  <div className="p-3">
                    <EditSchemaField
                      i={i}
                      value={field}
                      inObject={true}
                      onChange={(newValue) => {
                        const newFields = [...schema.fields];
                        newFields[i] = newValue;
                        setSchema({
                          ...schema,
                          fields: newFields,
                        });
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ))}
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                // Expand new field and collapse old one if it was filled out
                const newExpandedFields = new Set(expandedFields);
                newExpandedFields.add(schema.fields.length);
                if (schema.fields[schema.fields.length - 1]?.key) {
                  newExpandedFields.delete(schema.fields.length - 1);
                }
                setExpandedFields(newExpandedFields);

                setSchema({
                  ...schema,
                  fields: [
                    ...schema.fields,
                    {
                      key: "",
                      type: "string",
                      required: true,
                      default: "",
                      description: "",
                      enum: [],
                      min: 0,
                      max: 256,
                    },
                  ],
                });
              }}
            >
              <GBAddCircle /> Add Property
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EditSchemaModal({ feature, close, mutate }: Props) {
  const defaultSimpleSchema = feature.jsonSchema?.simple?.fields?.length
    ? feature.jsonSchema.simple
    : inferSimpleSchemaFromValue(feature.defaultValue);

  const defaultJSONSchema = feature.jsonSchema?.schema || "{}";

  console.log(feature.jsonSchema, defaultJSONSchema);

  const defaultSchemaType =
    feature.jsonSchema?.schemaType === "simple"
      ? "simple"
      : defaultJSONSchema !== "{}"
      ? "schema"
      : "simple";

  const form = useForm<Omit<JSONSchemaDef, "date">>({
    defaultValues: {
      schemaType: defaultSchemaType,
      simple: defaultSimpleSchema,
      schema: defaultJSONSchema,
      enabled: feature.jsonSchema?.enabled ?? true,
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header="Edit Feature Validation"
      cta="Save"
      size="lg"
      submit={form.handleSubmit(async (value) => {
        if (value.enabled && value.schemaType === "schema") {
          // make sure the json schema is valid json schema
          let schemaString = value.schema;
          let parsedSchema;
          try {
            if (schemaString !== "") {
              // first see if it is valid json:
              try {
                parsedSchema = JSON.parse(schemaString);
              } catch (e) {
                // If the JSON is invalid, try to parse it with 'dirty-json' instead
                parsedSchema = dJSON.parse(schemaString);
                schemaString = stringify(parsedSchema);
              }
              // make sure it is valid json schema:
              const ajv = getJSONValidator();
              ajv.compile(parsedSchema);
            }
          } catch (e) {
            throw new Error(
              `The JSON Schema is invalid. Please check it and try again. Validator error: "${e.message}"`
            );
          }

          if (schemaString !== value.schema) {
            form.setValue("schema", schemaString);
            throw new Error(
              "We fixed some errors in the schema. If it looks correct, save again."
            );
          }
        } else if (value.enabled && value.schemaType === "simple") {
          // This will throw an error if the simple schema is invalid
          const schemaString = simpleToJSONSchema(value.simple);
          try {
            const parsedSchema = JSON.parse(schemaString);
            const ajv = getJSONValidator();
            ajv.compile(parsedSchema);
          } catch (e) {
            throw new Error(
              `The Simple Schema is invalid. Please check it and try again. Validator error: "${e.message}"`
            );
          }
        }

        await apiCall(`/feature/${feature.id}/schema`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      close={close}
      open={true}
    >
      <div className="form-group">
        <Toggle
          id={"schemaEnabled"}
          value={form.watch("enabled")}
          setValue={(v) => form.setValue("enabled", v)}
        />{" "}
        <label htmlFor="schemaEnabled">Enable Validation</label>
      </div>
      {form.watch("enabled") && (
        <>
          <ButtonSelectField
            label={"Validation Type"}
            options={[
              {
                value: "simple",
                label: "Simple",
              },
              {
                value: "schema",
                label: "JSON Schema",
              },
            ]}
            value={form.watch("schemaType")}
            setValue={(v) => {
              form.setValue("schemaType", v);

              if (v === "schema" && form.watch("schema") === "{}") {
                try {
                  const schemaString = simpleToJSONSchema(form.watch("simple"));
                  form.setValue("schema", stringify(JSON.parse(schemaString)));
                } catch (e) {
                  // Ignore errors, we just want to set the default value
                }
              }
            }}
          />
          {form.watch("schemaType") === "simple" ? (
            <EditSimpleSchema
              schema={form.watch("simple")}
              setSchema={(v) => form.setValue("simple", v)}
            />
          ) : (
            <CodeTextArea
              language="json"
              label={`JSON Schema`}
              value={form.watch("schema")}
              setValue={(v) => form.setValue("schema", v)}
              minRows={20}
              helpText={`Enter a JSON Schema for this feature's value. See https://json-schema.org/ for more information.`}
            />
          )}
          <div className="alert alert-info">
            These validation rules will only apply going forward. Existing
            feature values will not be affected.
          </div>
        </>
      )}
    </Modal>
  );
}
