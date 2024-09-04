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
import clsx from "clsx";
import { JsonEditor as Editor } from "json-edit-react";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Modal from "@/components/Modal";
import { GBAddCircle } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import Button from "@/components/Button";

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
          label={label}
          placeholder={placeholder}
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

  if (valueType === "json") {
    return (
      <JSONTextEditor
        label={label}
        value={value}
        setValue={setValue}
        helpText={helpText}
        placeholder={placeholder}
      />
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
  showDescription,
}: {
  field: SchemaField;
  value: T;
  setValue: (value: T) => void;
  label?: ReactNode;
  showDescription?: boolean;
}): ReactElement {
  const uuid = useId();

  const isset = value != null;

  let containerClassName = "";
  let labelClassName = "";
  if (!field.required) {
    const checkbox = (
      <input
        type="checkbox"
        style={{ verticalAlign: "middle" }}
        title="Whether or not to include this optional field"
        name={`${uuid}_required`}
        className="ml-1 mr-2"
        checked={isset}
        onChange={(e) => {
          if (!isset && e.target.checked) {
            setValue(
              (field.type === "boolean"
                ? false
                : field.type === "string"
                ? ""
                : 0) as T
            );
          } else if (!e.target.checked) {
            setValue(undefined as T);
          }
        }}
      />
    );

    if (!label) {
      containerClassName = "d-flex align-items-center";
      labelClassName = "mb-0";
    }

    label = (
      <>
        {label} {checkbox}
      </>
    );
  }

  const helpText =
    showDescription && field.description ? field.description : "";

  if (field.enum?.length && field.type !== "boolean") {
    return (
      <SelectField
        options={field.enum.map((v) => ({
          label: v,
          value: v,
        }))}
        value={(value ?? "") + ""}
        onChange={(v) => {
          // If the field is a number, we need to convert the value to a number
          if (field.type === "float" || field.type === "integer") {
            setValue(parseFloat(v) as T);
          } else {
            setValue(v as T);
          }
        }}
        containerClassName={containerClassName}
        labelClassName={labelClassName}
        label={label}
        disabled={!field.required && !isset}
        helpText={helpText}
      />
    );
  }

  switch (field.type) {
    case "boolean":
      return label ? (
        <div className={clsx("form-group", containerClassName)}>
          <label htmlFor={uuid} className={labelClassName}>
            {label}
          </label>
          <div>
            <Toggle
              id={uuid}
              value={value as boolean}
              setValue={(v) => {
                setValue(v as T);
              }}
              type="featureValue"
              disabled={!field.required && !isset}
            />
          </div>
          {helpText && (
            <small className="form-text text-muted">{helpText}</small>
          )}
        </div>
      ) : (
        <>
          <div>
            <Toggle
              id={uuid}
              value={value as boolean}
              setValue={(v) => {
                setValue(v as T);
              }}
              type="featureValue"
              disabled={!field.required && !isset}
            />
          </div>
          {helpText && (
            <small className="form-text text-muted">{helpText}</small>
          )}
        </>
      );
    case "string":
      return (
        <Field
          containerClassName={containerClassName}
          labelClassName={labelClassName}
          label={label}
          value={(value ?? "") + ""}
          onChange={(e) => {
            setValue(e.target.value as T);
          }}
          minLength={field.min}
          maxLength={field.max}
          required={field.required}
          style={{ minWidth: 120 }}
          disabled={!field.required && !isset}
          helpText={helpText}
        />
      );
    case "integer":
    case "float":
      return (
        <Field
          containerClassName={containerClassName}
          labelClassName={labelClassName}
          label={label}
          value={(value ?? "") + ""}
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
          disabled={!field.required && !isset}
          helpText={helpText}
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
  placeholder,
}: {
  schema: SimpleSchema;
  value: string;
  setValue: (value: string) => void;
  renderInline?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  const fallback = (
    <JSONTextEditor
      value={value}
      setValue={setValue}
      label={label}
      placeholder={placeholder}
    />
  );

  let valueParsed: unknown = null;
  try {
    valueParsed = value ? JSON.parse(value) : null;
  } catch (e) {
    // Ignore
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
        showDescription={true}
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
    return (
      <>
        {open ? (
          <Modal
            open={true}
            header="Edit Value"
            size="lg"
            close={() => {
              setOpen(false);
            }}
            submit={async () => {
              setValue(tempValue);
            }}
            cta="Save"
            // Render with a higher z-index so it sits on top of other open modals
            increasedElevation={true}
          >
            <SimpleSchemaObjectArrayEditor
              type={schema.type}
              value={tempValue}
              setValue={setTempValue}
              fields={schema.fields}
              label={label}
              placeholder={placeholder}
            />
          </Modal>
        ) : null}
        <div>
          <Field
            textarea
            value={stringify(valueParsed)}
            maxRows={5}
            disabled
            label={label}
          />
          <a
            href="#"
            className="text-purple"
            onClick={(e) => {
              e.preventDefault();
              setTempValue(value);
              setOpen(true);
            }}
          >
            Edit Value <BsBoxArrowUpRight style={{ marginTop: -3 }} />
          </a>
        </div>
      </>
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
      placeholder={placeholder}
    />
  );
}

function JSONTextEditor({
  label,
  editAsForm,
  value,
  setValue,
  helpText,
  placeholder,
}: {
  label?: string;
  editAsForm?: () => void;
  value: string;
  setValue: (value: string) => void;
  helpText?: ReactNode;
  placeholder?: string;
}) {
  const { theme } = useAppearanceUITheme();
  const [useJson, setUseJson] = useState(false);
  if (useJson) {
    try {
      const parsed = JSON.parse(value);
      const setJson = (json) => {
        setValue(JSON.stringify(json));
      };

      const editorTheme = theme === "light" ? "githubLight" : "githubDark";
      return (
        <div>
          <Button
            onClick={() => {
              setUseJson(false);
            }}
          >
            Plain Text
          </Button>
          <div>
            <label>{label}</label>
          </div>
          <Editor
            data={parsed}
            setData={setJson}
            theme={editorTheme}
            maxWidth={10000}
          />
        </div>
      );
    } catch (e) {
      // Render normally if we can't parse json
    }
  }

  let formatted;
  let buttonDisabled = true;
  try {
    const parsed = dJSON.parse(value);
    formatted = stringify(parsed);
    buttonDisabled = false;
  } catch (e) {
    // Ignore
  }

  return (
    <div>
      <Button
        onClick={() => {
          setUseJson(true);
        }}
        disabled={buttonDisabled}
      >
        Json Editor
      </Button>
      <Field
        labelClassName={editAsForm ? "d-flex w-100" : ""}
        placeholder={placeholder}
        label={
          editAsForm ? (
            <>
              <div>{label}</div>
              {editAsForm && (
                <div className="ml-auto">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      editAsForm();
                    }}
                  >
                    Edit as Form
                  </a>
                </div>
              )}
            </>
          ) : (
            label
          )
        }
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        textarea
        minRows={1}
        helpText={
          <div className="d-flex align-items-top">
            {helpText && <div>{helpText}</div>}
            <a
              href="#"
              className={clsx("text-purple ml-auto", {
                "text-muted cursor-default no-underline":
                  !formatted || formatted === value,
              })}
              onClick={(e) => {
                e.preventDefault();
                if (formatted && formatted !== value) {
                  setValue(formatted);
                }
              }}
            >
              <FaMagic /> Format JSON
            </a>
          </div>
        }
      />
    </div>
  );
}

function SimpleSchemaObjectArrayEditor({
  type,
  value,
  fields,
  setValue,
  label,
  placeholder,
}: {
  type: "object" | "object[]";
  value: string;
  setValue: (value: string) => void;
  fields: SchemaField[];
  label?: string;
  placeholder?: string;
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
    <JSONTextEditor
      label={label}
      value={value}
      setValue={setValue}
      editAsForm={
        simpleEditorAllowed
          ? () => {
              setRawJSONInput(false);
            }
          : undefined
      }
      placeholder={placeholder}
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
                showDescription={true}
              />
            );
          })}
        </div>
      </div>
    );
  }
  // Array of Objects - Render as a table
  if (type === "object[]") {
    let items = (valueParsed as Record<string, unknown>[]) || [];
    if (!items || !Array.isArray(items)) items = [];
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
                  <th key={field.key}>
                    {field.key}{" "}
                    {field.description ? (
                      <Tooltip body={field.description} />
                    ) : null}
                  </th>
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
