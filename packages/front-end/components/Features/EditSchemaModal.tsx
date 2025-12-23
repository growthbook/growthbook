import { useForm } from "react-hook-form";
import {
  FeatureInterface,
  JSONSchemaDef,
  SchemaField,
  SimpleSchema,
} from "shared/types/feature";
import React, { useState } from "react";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import {
  getJSONValidator,
  inferSimpleSchemaFromValue,
  simpleToJSONSchema,
} from "shared/util";
import { FaAngleDown, FaAngleRight, FaRegTrashAlt } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { GBAddCircle } from "@/components/Icons";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Checkbox from "@/ui/Checkbox";

export interface Props {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
  defaultEnable?: boolean;
  onEnable?: () => void;
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
              maxLength={64}
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
        maxLength={256}
      />
      {inObject && (
        <div className="form-group">
          <Checkbox
            id={`schema_required_${i}`}
            value={value.required}
            setValue={(v) => onChange({ ...value, required: v })}
            description="Check if this property is required"
            label="Required"
          />
        </div>
      )}
      {value.type !== "boolean" && (
        <>
          <MultiSelectField
            label="Restrict to Specific Values"
            placeholder="(Optional)"
            value={value.enum}
            onChange={(e) => {
              if (e.length > 256) return;
              e = e.filter((v) => v !== "" && v != null && v.length <= 256);
              onChange({ ...value, enum: e });
            }}
            options={value.enum.map((v) => ({ value: v, label: v }))}
            creatable
            noMenu
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
                  max={value.type === "string" ? 256 : undefined}
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
        labelClassName="font-weight-bold text-dark"
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
          <label className="font-weight-bold text-dark">
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
          <label className="font-weight-bold text-dark">
            Object Properties
          </label>
          <div>
            {schema.fields.map((field, i) => (
              <div key={i} className="d-flex align-items-top mb-2">
                <div className="flex-1 border rounded ">
                  <a
                    href="#"
                    className="d-flex align-items-center cursor-pointer p-2 no-underline"
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
                    <strong className="mb-0 text-dark">
                      {field.key ? field.key : "New Property"}
                    </strong>
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
                    <div className="ml-auto">
                      {expandedFields.has(i) ? (
                        <FaAngleDown />
                      ) : (
                        <FaAngleRight />
                      )}
                    </div>
                  </a>
                  {expandedFields.has(i) ? (
                    <div className="border-top bg-light p-3 mb-0">
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
                <div>
                  <button
                    className="btn btn-link text-danger ml-auto"
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
                    <FaRegTrashAlt />
                  </button>
                </div>
              </div>
            ))}
            <a
              href="#"
              className="text-purple"
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
              <GBAddCircle /> Add property
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EditSchemaModal({
  feature,
  close,
  mutate,
  defaultEnable,
  onEnable,
}: Props) {
  const defaultSimpleSchema = feature.jsonSchema?.simple?.fields?.length
    ? feature.jsonSchema.simple
    : inferSimpleSchemaFromValue(feature.defaultValue);

  const defaultJSONSchema = feature.jsonSchema?.schema || "{}";

  // Default to simple schema unless they already have a JSON schema entered
  const defaultSchemaType =
    feature.jsonSchema?.schemaType === "simple" || defaultJSONSchema === "{}"
      ? "simple"
      : "schema";

  const form = useForm<Omit<JSONSchemaDef, "date">>({
    defaultValues: {
      schemaType: defaultSchemaType,
      simple: defaultSimpleSchema,
      schema: defaultJSONSchema,
      enabled: defaultEnable ? true : (feature.jsonSchema?.enabled ?? true),
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      trackingEventModalType=""
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
              `The JSON Schema is invalid. Please check it and try again. Validator error: "${e.message}"`,
            );
          }

          if (schemaString !== value.schema) {
            form.setValue("schema", schemaString);
            throw new Error(
              "We fixed some errors in the schema. If it looks correct, save again.",
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
              `The Simple Schema is invalid. Please check it and try again. Validator error: "${e.message}"`,
            );
          }
        }

        await apiCall(`/feature/${feature.id}/schema`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
        onEnable && value.enabled && onEnable();
      })}
      close={close}
      open={true}
    >
      <Switch
        id={"schemaEnabled"}
        label="Enable Validation"
        description="These validation rules will only apply going forward. Existing feature values will not be affected."
        value={form.watch("enabled")}
        onChange={(v) => form.setValue("enabled", v)}
        mb="4"
      />
      {form.watch("enabled") && (
        <>
          <div className="form-group">
            <label className="font-weight-bold text-dark">
              Validation Type
            </label>
            <div className="d-flex">
              <label className="text-dark d-flex align-items-center">
                <input
                  type="radio"
                  name="validation_type"
                  value="simple"
                  checked={form.watch("schemaType") === "simple"}
                  onChange={() => form.setValue("schemaType", "simple")}
                />
                <div className="ml-2">Simple</div>
              </label>
              <label className="ml-4 text-dark d-flex align-items-center">
                <input
                  type="radio"
                  name="validation_type"
                  value="schema"
                  checked={form.watch("schemaType") === "schema"}
                  onChange={() => {
                    form.setValue("schemaType", "schema");

                    if (form.watch("schema") === "{}") {
                      try {
                        const schemaString = simpleToJSONSchema(
                          form.watch("simple"),
                        );
                        form.setValue(
                          "schema",
                          stringify(JSON.parse(schemaString)),
                        );
                      } catch (e) {
                        // Ignore errors, we just want to set the default value
                      }
                    }
                  }}
                />
                <div className="ml-2">JSON Schema</div>
              </label>
            </div>
          </div>
          {form.watch("schemaType") === "simple" ? (
            <EditSimpleSchema
              schema={form.watch("simple")}
              setSchema={(v) => form.setValue("simple", v)}
            />
          ) : (
            <CodeTextArea
              language="json"
              label={`JSON Schema`}
              labelClassName="font-weight-bold text-dark"
              value={form.watch("schema")}
              setValue={(v) => form.setValue("schema", v)}
              minRows={20}
              helpText={`Enter a JSON Schema for this feature's value. See https://json-schema.org/ for more information.`}
            />
          )}
        </>
      )}
    </Modal>
  );
}
