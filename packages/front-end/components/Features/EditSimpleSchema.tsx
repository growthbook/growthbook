import { useState } from "react";
import { SchemaField, SimpleSchema } from "shared/types/feature";
import { FaAngleDown, FaAngleRight, FaRegTrashAlt } from "react-icons/fa";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Checkbox from "@/ui/Checkbox";
import { GBAddCircle } from "@/components/Icons";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

// TODO: enable this when we have a GUI for entering feature values based on the schema
const SUPPORTS_DEFAULT_VALUES = false;

export function EditSchemaField({
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
              { value: "string", label: "Text String" },
              { value: "integer", label: "Integer" },
              { value: "float", label: "Float (Decimal)" },
              { value: "boolean", label: "Boolean (True/False)" },
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
                { value: "true", label: "True" },
                { value: "false", label: "False" },
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

// Editor for a SimpleSchema (the data shape shared by JSON-schema validation
// and `object`-typed features). When `lockType` is set the top-level type
// selector is hidden and the schema's top-level type is forced to that value.
export default function EditSimpleSchema({
  schema,
  setSchema,
  lockType,
}: {
  schema: SimpleSchema;
  setSchema: (schema: SimpleSchema) => void;
  lockType?: SimpleSchema["type"];
}) {
  const [expandedFields, setExpandedFields] = useState(new Set<number>());

  return (
    <div>
      {!lockType && (
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
            { value: "object", label: "Object" },
            { value: "object[]", label: "Array of Objects" },
            {
              value: "primitive",
              label: "Primitive Value (string, number, boolean)",
            },
            { value: "primitive[]", label: "Array of Primitive Values" },
          ]}
          required
        />
      )}
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
