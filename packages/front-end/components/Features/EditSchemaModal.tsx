import { useForm } from "react-hook-form";
import {
  FeatureInterface,
  FeatureValueType,
  JSONSchemaDef,
  SimpleSchema,
} from "shared/types/feature";
import React, { useMemo, useState } from "react";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import {
  getJSONValidator,
  inferSimpleSchemaFromValue,
  simpleToJSONSchema,
  getReviewSetting,
  assertSchemaMatchesValueType,
} from "shared/util";
import { FaAngleDown, FaAngleRight, FaRegTrashAlt } from "react-icons/fa";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useDefaultDraftMode } from "@/hooks/useDefaultDraft";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import Switch from "@/ui/Switch";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SelectField from "@/components/Forms/SelectField";
import { GBAddCircle } from "@/components/Icons";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Link from "@/ui/Link";
import EditSchemaField from "@/components/Features/EditSchemaField";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";

export interface Props {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
  setVersion?: (version: number) => void;
  revisionList?: MinimalFeatureRevisionInterface[];
  defaultEnable?: boolean;
  onEnable?: () => void;
}

function EditSimpleSchema({
  schema,
  setSchema,
  valueType,
}: {
  schema: SimpleSchema;
  setSchema: (schema: SimpleSchema) => void;
  valueType?: FeatureValueType;
}) {
  const [expandedFields, setExpandedFields] = useState(new Set<number>());

  const lockedPrimitive = valueType === "string" || valueType === "number";

  return (
    <div>
      {!lockedPrimitive && (
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
      )}
      {lockedPrimitive ||
      schema.type === "primitive[]" ||
      schema.type === "primitive" ? (
        <div className="form-group">
          <label className="font-weight-bold text-dark">
            {schema.type === "primitive[]" ? "Array Items" : "Primitive Value"}
          </label>
          <div className="appbox p-3 bg-light">
            <EditSchemaField
              i={0}
              valueType={valueType}
              value={
                schema.fields[0] || {
                  key: "",
                  type: valueType === "number" ? "float" : "string",
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
                  <Link
                    className="d-flex align-items-center cursor-pointer p-2 no-underline"
                    onClick={() => {
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
                  </Link>
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
            <Link
              className="text-purple"
              onClick={() => {
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
            </Link>
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
  setVersion,
  revisionList = [],
  defaultEnable,
  onEnable,
}: Props) {
  const valueType = feature.valueType;
  const defaultSimpleSchema: SimpleSchema = feature.jsonSchema?.simple?.fields
    ?.length
    ? feature.jsonSchema.simple
    : valueType === "string" || valueType === "number"
      ? {
          // String/number flags hold a single primitive value
          type: "primitive",
          fields: [
            {
              key: "",
              type: valueType === "string" ? "string" : "float",
              required: true,
              default: "",
              description: "",
              enum: [],
              min: 0,
              max: valueType === "string" ? 256 : 100,
            },
          ],
        }
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
  const settings = useOrgSettings();

  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const canAutoPublish = gatedEnvSet === "none";

  const { mode: initialMode, defaultDraft } = useDefaultDraftMode(
    revisionList,
    canAutoPublish,
  );

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  return (
    <ModalStandard
      trackingEventModalType=""
      header="Edit Feature Validation"
      cta={mode === "publish" ? "Publish" : "Save to Draft"}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        if (value.enabled && value.schemaType === "schema") {
          let schemaString = value.schema;
          let parsedSchema;
          try {
            if (schemaString !== "") {
              try {
                parsedSchema = JSON.parse(schemaString);
              } catch (e) {
                // Fall back to dirty-json for lenient parsing
                parsedSchema = dJSON.parse(schemaString);
                schemaString = stringify(parsedSchema);
              }
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

        assertSchemaMatchesValueType(value, feature.valueType);

        const body: Record<string, unknown> = {
          ...value,
          ...(mode === "publish"
            ? { autoPublish: true }
            : mode === "existing"
              ? { targetDraftVersion: selectedDraft }
              : { forceNewDraft: true }),
        };
        const res = await apiCall<{ draftVersion?: number }>(
          `/feature/${feature.id}/schema`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
        mutate();
        const resolvedVersion =
          res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
        if (resolvedVersion !== null && setVersion) setVersion(resolvedVersion);
        onEnable && value.enabled && onEnable();
      })}
      close={close}
      open={true}
    >
      <DraftSelectorForChanges
        feature={feature}
        revisionList={revisionList}
        mode={mode}
        setMode={setMode}
        selectedDraft={selectedDraft}
        setSelectedDraft={setSelectedDraft}
        canAutoPublish={canAutoPublish}
        gatedEnvSet={gatedEnvSet}
      />
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
              valueType={valueType}
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
    </ModalStandard>
  );
}
