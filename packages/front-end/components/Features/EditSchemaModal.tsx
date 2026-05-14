import { useForm } from "react-hook-form";
import { FeatureInterface, JSONSchemaDef } from "shared/types/feature";
import React, { useMemo, useState } from "react";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import {
  getJSONValidator,
  inferSimpleSchemaFromValue,
  simpleToJSONSchema,
  getReviewSetting,
} from "shared/util";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import Switch from "@/ui/Switch";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import EditSimpleSchema from "@/components/Features/EditSimpleSchema";

export interface Props {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
  setVersion?: (version: number) => void;
  revisionList?: MinimalFeatureRevisionInterface[];
  defaultEnable?: boolean;
  onEnable?: () => void;
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

  const defaultDraft = useDefaultDraft(revisionList);

  const [mode, setMode] = useState<DraftMode>(
    canAutoPublish ? "publish" : "new",
  );
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
        if (resolvedVersion != null && setVersion) setVersion(resolvedVersion);
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
