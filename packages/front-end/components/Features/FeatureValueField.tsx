import {
  FeatureInterface,
  FeatureValueType,
  SchemaField,
  SimpleSchema,
} from "back-end/types/feature";
import { ReactElement, ReactNode, useId, useState } from "react";
import { getValidation } from "shared/util";
import { FaMagic, FaRegTrashAlt } from "react-icons/fa";
import stringify from "json-stringify-pretty-compact";
import { BsBoxArrowUpRight } from "react-icons/bs";
import dJSON from "dirty-json";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Modal from "@/components/Modal";
import { GBAddCircle } from "@/components/Icons";
import Code from "@/components/SyntaxHighlighting/Code";

export interface Props {
  valueType: FeatureValueType;
  label: string;
  value: string;
  setValue: (v: string) => void;
  id: string;
  helpText?: ReactNode;
  type?: string;
  placeholder?: string;
  feature?: FeatureInterface;
  hideParentModal?: () => void;
  showParentModal?: () => void;
  renderJSONInline?: boolean;
}

export default function FeatureValueField({
  valueType,
  label,
  value,
  setValue,
  id,
  helpText,
  placeholder,
  feature,
  renderJSONInline,
  hideParentModal,
  showParentModal,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const hasJsonValidator = hasCommercialFeature("json-validation");
  const { simpleSchema, validationEnabled } = feature
    ? getValidation(feature)
    : { simpleSchema: null, validationEnabled: null };

  if (
    validationEnabled &&
    hasJsonValidator &&
    valueType === "json" &&
    simpleSchema
  ) {
    return (
      <>
        <SimpleSchemaEditor
          schema={simpleSchema}
          value={value}
          setValue={setValue}
          renderInline={renderJSONInline}
          hideParentModal={hideParentModal}
          showParentModal={showParentModal}
          label={label}
        />
        {helpText && <small className="text-muted">{helpText}</small>}
      </>
    );
  }

  if (valueType === "boolean") {
    return (
      <div className="form-group">
        <label>{label}</label>
        <div>
          <Toggle
            id={id + "__toggle"}
            value={value === "true"}
            setValue={(v) => {
              setValue(v ? "true" : "false");
            }}
            type="featureValue"
          />
          <span className="text-gray font-weight-bold pl-2">
            {value === "true" ? "TRUE" : "FALSE"}
          </span>
        </div>
        {helpText && <small className="text-muted">{helpText}</small>}
      </div>
    );
  }

  return (
    <Field
      label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      {...(valueType === "number"
        ? {
            type: "number",
            step: "any",
            min: "any",
            max: "any",
          }
        : valueType === "json"
        ? { minRows: 4, textarea: true }
        : {
            textarea: true,
            minRows: 1,
          })}
      helpText={helpText}
    />
  );
}

function SimpleSchemaPrimitiveEditor<T = unknown>({
  field,
  value,
  setValue,
  label,
}: {
  field: SchemaField;
  value: T;
  setValue: (value: T) => void;
  label?: string;
}): ReactElement {
  const uuid = useId();

  if (field.enum?.length && field.type !== "boolean") {
    return (
      <SelectField
        options={field.enum.map((v) => ({
          label: v,
          value: v,
        }))}
        value={value + ""}
        onChange={(v) => {
          // If the field is a number, we need to convert the value to a number
          if (field.type === "float" || field.type === "integer") {
            setValue(parseFloat(v) as T);
          } else {
            setValue(v as T);
          }
        }}
        label={label}
      />
    );
  }

  switch (field.type) {
    case "boolean":
      return label ? (
        <div className="form-group">
          <label htmlFor={uuid}>{label}</label>
          <div>
            <Toggle
              id={uuid}
              value={value as boolean}
              setValue={(v) => {
                setValue(v as T);
              }}
              type="featureValue"
            />
          </div>
        </div>
      ) : (
        <Toggle
          id={uuid}
          value={value as boolean}
          setValue={(v) => {
            setValue(v as T);
          }}
          type="featureValue"
        />
      );
    case "string":
      return (
        <Field
          label={label}
          value={value as string}
          onChange={(e) => {
            setValue(e.target.value as T);
          }}
          minLength={field.min}
          maxLength={field.max}
          required={field.required}
          style={{ minWidth: 120 }}
        />
      );
    case "integer":
    case "float":
      return (
        <Field
          label={label}
          value={value + ""}
          onChange={(e) => {
            setValue(
              (e.target.value === ""
                ? undefined
                : parseFloat(e.target.value)) as T
            );
          }}
          type="number"
          step={field.type === "integer" ? "1" : "any"}
          min={field.min}
          max={field.max}
          required={field.required}
          style={{ minWidth: 80 }}
        />
      );
  }
}

function SimpleSchemaEditor({
  schema,
  value,
  setValue,
  renderInline,
  label,
  hideParentModal,
  showParentModal,
}: {
  schema: SimpleSchema;
  value: string;
  setValue: (value: string) => void;
  renderInline?: boolean;
  label?: string;
  hideParentModal?: () => void;
  showParentModal?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  const fallback = (
    <Field
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      textarea
      minRows={4}
      label={label}
    />
  );

  let valueParsed: unknown;
  try {
    valueParsed = value ? JSON.parse(value) : null;
  } catch (e) {
    return fallback;
  }

  // Single primitive value
  if (schema.type === "primitive") {
    const field = schema.fields[0];
    if (!field) return fallback;

    return (
      <SimpleSchemaPrimitiveEditor
        field={field}
        value={valueParsed}
        setValue={(v) => setValue(JSON.stringify(v))}
        label={label}
      />
    );
  }
  // Array of primitive values (using multi-select)
  if (schema.type === "primitive[]") {
    const field = schema.fields[0];
    if (!field) return fallback;
    // Don't really know what to render for an array of booleans
    if (field.type === "boolean") return fallback;
    if (!valueParsed) valueParsed = [];
    if (!Array.isArray(valueParsed)) return fallback;

    const options = field.enum.length
      ? field.enum.map((v) => ({
          label: v,
          value: v,
        }))
      : valueParsed.map((v) => ({
          label: v + "",
          value: v + "",
        }));

    return (
      <MultiSelectField
        options={options}
        value={valueParsed.map((v) => v + "")}
        onChange={(v) => {
          // If the field is a number, we need to convert the value to a number
          if (field.type === "float" || field.type === "integer") {
            setValue(
              JSON.stringify(
                v.map((v) => parseFloat(v)).filter((v) => !isNaN(v))
              )
            );
          } else {
            setValue(JSON.stringify(v));
          }
        }}
        placeholder="Select options"
        creatable={!field.enum.length}
        label={label}
      />
    );
  }

  if (!renderInline) {
    if (!open) {
      return (
        <div className="form-group">
          {label ? <label>{label}</label> : null}
          <Code
            language="json"
            code={stringify(valueParsed)}
            expandable
            containerClassName="mt-0 mb-2"
          />
          <a
            href="#"
            className="text-purple"
            onClick={(e) => {
              e.preventDefault();
              setTempValue(value);
              setOpen(true);
              hideParentModal && hideParentModal();
            }}
          >
            Edit Value <BsBoxArrowUpRight style={{ marginTop: -3 }} />
          </a>
        </div>
      );
    }
    return (
      <Modal
        open={true}
        header="Edit Value"
        size="lg"
        close={() => {
          setOpen(false);
          showParentModal && showParentModal();
        }}
        submit={async () => {
          setValue(tempValue);
        }}
        cta="Save"
      >
        <SimpleSchemaObjectArrayEditor
          type={schema.type}
          value={tempValue}
          setValue={setTempValue}
          fields={schema.fields}
          label={label}
        />
      </Modal>
    );
  }

  // Render inline
  return (
    <SimpleSchemaObjectArrayEditor
      type={schema.type}
      value={value}
      setValue={setValue}
      fields={schema.fields}
      label={label}
    />
  );
}

function SimpleSchemaObjectArrayEditor({
  type,
  value,
  fields,
  setValue,
  label,
}: {
  type: "object" | "object[]";
  value: string;
  setValue: (value: string) => void;
  fields: SchemaField[];
  label?: string;
}) {
  let valueParsed: unknown;
  try {
    valueParsed = JSON.parse(value);
  } catch (e) {
    // Ignore
  }
  const simpleEditorAllowed = !!valueParsed;

  const [rawJSONInput, setRawJSONInput] = useState(!simpleEditorAllowed);

  const fallback = (
    <Field
      labelClassName="d-flex w-100"
      label={
        <>
          <div>{label}</div>
          {simpleEditorAllowed && (
            <div className="ml-auto">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setRawJSONInput(false);
                }}
              >
                Edit as Form
              </a>
            </div>
          )}
        </>
      }
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      textarea
      minRows={4}
      helpText={
        <a
          href="#"
          className="text-purple"
          onClick={(e) => {
            e.preventDefault();
            try {
              const parsed = dJSON.parse(value);
              setValue(stringify(parsed));
            } catch (e) {
              console.error(e);
            }
          }}
        >
          <FaMagic /> Format JSON
        </a>
      }
    />
  );

  if (rawJSONInput || !simpleEditorAllowed) return fallback;

  // Object - Render each field as a separate input
  if (type === "object") {
    const obj = (valueParsed as Record<string, unknown>) || {};
    return (
      <div className="form-group">
        <div className="d-flex">
          <label>{label}</label>
          <a
            href="#"
            className="ml-auto"
            onClick={(e) => {
              e.preventDefault();
              setRawJSONInput(true);
            }}
          >
            Edit as JSON
          </a>
        </div>
        <div className="appbox bg-light px-3 pt-3">
          {fields.map((field) => {
            const value = obj[field.key];
            return (
              <SimpleSchemaPrimitiveEditor
                label={field.key}
                key={field.key}
                field={field}
                value={value}
                setValue={(v) => {
                  setValue(
                    JSON.stringify({
                      ...obj,
                      [field.key]: v,
                    })
                  );
                }}
              />
            );
          })}
        </div>
      </div>
    );
  }
  // Array of Objects - Render as a table
  if (type === "object[]") {
    const items = (valueParsed as Record<string, unknown>[]) || [];
    return (
      <div className="form-group">
        <div className="d-flex">
          <label>{label}</label>
          <a
            href="#"
            className="ml-auto"
            onClick={(e) => {
              e.preventDefault();
              setRawJSONInput(true);
            }}
          >
            Edit as JSON
          </a>
        </div>
        <div style={{ overflowX: "auto" }} className="mb-3">
          <table
            className="table w-auto mb-0 bg-light border"
            style={{ minWidth: "100%" }}
          >
            <thead>
              <tr>
                <th></th>
                {fields.map((field) => (
                  <th key={field.key}>{field.key}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={fields.length + 2}>
                    <em>No items</em>
                  </td>
                </tr>
              ) : null}
              {items.map((item, i) => {
                return (
                  <tr key={i}>
                    <td className="px-0 text-right">
                      <div style={{ paddingTop: 6 }}>{i + 1}</div>
                    </td>
                    {fields.map((field) => (
                      <td key={field.key}>
                        <SimpleSchemaPrimitiveEditor
                          field={field}
                          value={item[field.key]}
                          setValue={(v) => {
                            const newItems = [...items];
                            newItems[i] = {
                              ...newItems[i],
                              [field.key]: v,
                            };
                            setValue(JSON.stringify(newItems));
                          }}
                        />
                      </td>
                    ))}
                    <td className="px-0">
                      <a
                        className="text-danger"
                        href="#"
                        style={{
                          verticalAlign: "middle",
                          fontSize: "1.2em",
                          paddingTop: 2,
                          display: "block",
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          const newItems = [...items];
                          newItems.splice(i, 1);
                          setValue(JSON.stringify(newItems));
                        }}
                      >
                        <FaRegTrashAlt />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="d-flex">
          <a
            href="#"
            className="text-purple"
            onClick={(e) => {
              e.preventDefault();
              setValue(
                JSON.stringify([
                  ...items,
                  Object.fromEntries(
                    fields.map((field) => [
                      field.key,
                      field.default
                        ? JSON.parse(field.default)
                        : field.type === "boolean"
                        ? false
                        : field.type === "string"
                        ? ""
                        : 0,
                    ])
                  ),
                ])
              );
            }}
          >
            <GBAddCircle className="mr-1" /> Add Row
          </a>
          <a
            href="#"
            className="ml-auto text-danger"
            onClick={(e) => {
              e.preventDefault();
              setValue("[]");
            }}
          >
            Clear All
          </a>
        </div>
      </div>
    );
  }

  return fallback;
}
