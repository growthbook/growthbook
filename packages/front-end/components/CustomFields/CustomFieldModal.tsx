import { useForm } from "react-hook-form";
import {
  CustomField,
  CustomFieldSection,
  CustomFieldTypes,
} from "shared/types/custom-fields";
import React, { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  getCustomFieldChangeWarning,
  getCustomFieldProjectChangeWarning,
} from "shared/util";
import { generateTrackingKey } from "shared/experiments";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import track from "@/services/track";
import { useCustomFields } from "@/hooks/useCustomFields";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import Checkbox from "@/ui/Checkbox";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import DatePicker from "@/components/DatePicker";
import MarkdownInput from "@/components/Markdown/MarkdownInput";

export default function CustomFieldModal({
  existing,
  section,
  close,
  onSuccess,
}: {
  existing: Partial<CustomField>;
  section: CustomFieldSection;
  close: () => void;
  onSuccess?: () => void;
}) {
  const { project, projects } = useDefinitions();
  const { apiCall } = useAuth();

  const form = useForm<CustomField>({
    defaultValues: {
      id: existing.id || "",
      name: existing.name || "",
      description: existing.description || "",
      values: existing.values || "",
      type: existing.type || "text",
      placeholder: existing.placeholder || "",
      defaultValue: existing.defaultValue
        ? existing.defaultValue
        : existing.type === "boolean"
          ? (existing.defaultValue ?? false)
          : "",
      section: existing.section ?? section,
      projects: existing.projects || (project ? [project] : []),
      required: existing.required ?? false,
      index: true,
    },
  });
  const customFields = useCustomFields();

  // Auto-link name to id for new custom fields
  const [linkNameWithKey, setLinkNameWithKey] = useState(!existing.id);

  // Calculate warning messages for destructive changes
  const currentType = form.watch("type");
  const currentValues = form.watch("values");
  const currentProjects = form.watch("projects");

  const typeWarning = useMemo(() => {
    if (!existing.id) return null; // Only show for edits
    if (existing.type === currentType) return null; // Only for type changes
    
    return getCustomFieldChangeWarning(
      existing.type || "text",
      currentType,
      existing.values,
      currentValues,
    );
  }, [
    existing.id,
    existing.type,
    existing.values,
    currentType,
    currentValues,
  ]);

  const valueWarning = useMemo(() => {
    if (!existing.id) return null; // Only show for edits
    if (existing.type !== currentType) return null; // Only for same type
    if (currentType !== "enum" && currentType !== "multiselect") return null;
    if (!existing.values || !currentValues) return null;
    if (existing.values === currentValues) return null;

    const oldOptions = existing.values.split(",").map((v) => v.trim());
    const newOptions = currentValues.split(",").map((v) => v.trim());
    const removedOptions = oldOptions.filter((opt) => !newOptions.includes(opt));
    
    if (removedOptions.length > 0) {
      return `Removing options may result in data loss. Existing values that are no longer in the options list will be removed.`;
    }
    return null;
  }, [
    existing.id,
    existing.type,
    existing.values,
    currentType,
    currentValues,
  ]);

  const projectWarning = useMemo(() => {
    if (!existing.id) return null; // Only show for edits
    return getCustomFieldProjectChangeWarning(
      existing.projects,
      currentProjects,
    );
  }, [
    existing.id,
    existing.projects,
    currentProjects,
  ]);

  const fieldOptions = [
    "text",
    "textarea",
    "markdown",
    "enum",
    "multiselect",
    "boolean",
    "url",
    "number",
    "date",
    "datetime",
  ];

  const availableProjects: (SingleValue | GroupedValue)[] = projects
    .slice()
    .sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1))
    .map((p) => ({ value: p.id, label: p.name }));

  const showSearchableToggle = false;
  return (
    <Modal
      trackingEventModalType="custom-field"
      open={true}
      close={close}
      header={existing.id ? `Edit Custom Field` : "Create New Custom Field"}
      cta="Save"
      useRadixButton={true}
      submit={form.handleSubmit(async (value) => {
        if (value.type === "boolean") {
          // make sure the default value is a boolean
          value.defaultValue = !!value.defaultValue;
          // unset any placeholder value, as this is not applicable to boolean fields
          value.placeholder = "";
        }

        if (
          (value.type === "multiselect" || value.type === "enum") &&
          value.defaultValue
        ) {
          // make sure the default value is an array
          const defaultValue = "" + value.defaultValue;
          const possibleValues = value.values
            ? value.values.split(",").map((k) => k.trim())
            : [];
          // check the array of values to see if the default value exists as one of the options:
          if (!possibleValues.includes(defaultValue)) {
            throw new Error("Default value must be one of the options");
          }
          // unset any placeholder value, as this is not applicable to boolean fields
          value.placeholder = "";
        }
        if (existing.id) {
          const edit = customFields.filter((e) => e.id === existing.id)[0];
          if (!edit) throw new Error("Could not edit custom field");
          edit.name = value?.name ?? "";
          edit.type = value?.type ?? "text";
          edit.required = value?.required ?? false;
          edit.values = value.values;
          edit.defaultValue = value.defaultValue;
          edit.description = value?.description ?? "";
          edit.placeholder = value?.placeholder ?? "";
          edit.projects = value.projects;
          edit.section = value.section;

          await apiCall(`/custom-fields/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(edit),
          });

          track("Edit Custom Experiment Field", {
            type: value.type,
          });
        } else {
          const newCustomFields: Partial<CustomField> = {
            id: value.id ?? "",
            name: value.name ?? "",
            values: value.values,
            description: value.description ?? "",
            placeholder: value.placeholder ?? "",
            defaultValue: value.defaultValue,
            projects: value.projects,
            type: value.type ?? "text",
            required: value.required ?? false,
            section: value.section,
          };

          await apiCall(`/custom-fields`, {
            method: "POST",
            body: JSON.stringify(newCustomFields),
          });

          track("Edit Custom Experiment Field", {
            type: value.type,
          });
        }

        if (onSuccess) {
          onSuccess();
        }
      })}
    >
      <Flex direction="column" gap="5">
        <Field
          label="Name"
          {...form.register("name")}
          placeholder=""
          required={true}
          onChange={async (e) => {
            form.setValue("name", e.target.value);
            // Auto-generate key from name if still linked
            if (!existing.id && linkNameWithKey && e.target.value) {
              const key = await generateTrackingKey(
                { name: e.target.value },
                async (key: string) =>
                  customFields.find((cf) => cf.id === key) ?? null,
              );
              form.setValue("id", key);
            }
          }}
          containerClassName="mb-0"
        />
        <Field
          label="Key"
          {...form.register("id")}
          pattern="^[a-z0-9_-]+$"
          placeholder=""
          required={true}
          helpText={
            !existing.id ? (
              <>
                Lowercase letters, numbers, _ and - only. <strong>Cannot be changed later!</strong>
              </>
            ) : undefined
          }
          disabled={!!existing.id}
          onChange={async (e) => {
            form.setValue("id", e.target.value);
            // Break the link if user manually edits the key
            if (linkNameWithKey) {
              const expectedKey = await generateTrackingKey(
                { name: form.watch("name") },
                async (key: string) =>
                  customFields.find((cf) => cf.id === key) ?? null,
              );
              if (e.target.value !== expectedKey) {
                setLinkNameWithKey(false);
              }
            }
          }}
          containerClassName="mb-0"
        />
        <Field
          label="Description"
          textarea={true}
          minRows={1}
          maxRows={4}
          {...form.register("description")}
          containerClassName="mb-0"
        />
        <Box>
          <Text as="label" mb="2" weight="medium">
            Applies to
          </Text>
          <RadioGroup
            value={form.watch("section") ?? section}
            setValue={(v) => form.setValue("section", v as CustomFieldSection)}
            options={[
              { value: "feature", label: "Features" },
              { value: "experiment", label: "Experiments" },
            ]}
          />
        </Box>
        {projects?.length > 0 && (
          <Box>
            <MultiSelectField
              label="Projects"
              value={form.watch("projects") ?? []}
              placeholder="All projects"
              options={availableProjects}
              onChange={(v) => {
                form.setValue("projects", v);
              }}
              className="label-overflow-ellipsis"
              helpText="Restrict this field to specific projects"
              containerClassName="mb-0"
            />
            {projectWarning && (
              <Callout status="warning" mt="2">
                {projectWarning}
              </Callout>
            )}
          </Box>
        )}
        <Field
          label="Description"
          {...form.register("description")}
          helpText="Shown as a tool tip to users entering this field value"
          containerClassName="mb-0"
        />
        <Box>
          <SelectField
            label="Value type"
            value={form.watch("type") ?? "text"}
            options={fieldOptions.map((o) => ({ label: o, value: o }))}
            onChange={(v: CustomFieldTypes) => {
              form.setValue("type", v);
            }}
            containerClassName="mb-0"
          />
          {typeWarning && (
            <Callout status="warning" mt="2">
              {typeWarning}
            </Callout>
          )}
        </Box>
        {(form.watch("type") === "enum" ||
          form.watch("type") === "multiselect") && (
          <Box>
            <StringArrayField
              label="Values"
              value={
                form
                  .watch("values")
                  ?.split(",")
                  .map((v) => v.trim())
                  .filter(Boolean) || []
              }
              onChange={(values) => form.setValue("values", values.join(","))}
              helpText="List of possible values"
              placeholder="Add value..."
              containerClassName="mb-0"
            />
            {valueWarning && (
              <Callout status="warning" mt="2">
                {valueWarning}
              </Callout>
            )}
          </Box>
        )}
        {form.watch("type") !== "boolean" ? (
          <>
            {form.watch("type") === "date" || form.watch("type") === "datetime" ? (
              <DatePicker
                date={form.watch("defaultValue") as string | undefined}
                setDate={(d) => {
                  form.setValue("defaultValue", d?.toISOString() ?? "");
                }}
                label="Default value"
                precision={form.watch("type") === "datetime" ? "datetime" : "date"}
                containerClassName="mb-0"
              />
            ) : form.watch("type") === "enum" ||
              form.watch("type") === "multiselect" ? (
              <SelectField
                label="Default value"
                value={(form.watch("defaultValue") as string) || ""}
                onChange={(v) => form.setValue("defaultValue", v)}
                options={
                  form
                    .watch("values")
                    ?.split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                    .map((v) => ({ label: v, value: v })) || []
                }
                isClearable
                placeholder="Select a default value..."
                containerClassName="mb-0"
              />
            ) : form.watch("type") === "markdown" ? (
              <Box>
                <Text as="label" mb="2" weight="medium">
                  Default value
                </Text>
                <MarkdownInput
                  value={(form.watch("defaultValue") as string) || ""}
                  setValue={(v) => form.setValue("defaultValue", v)}
                  placeholder="Enter default markdown content..."
                  maxRows={3}
                />
              </Box>
            ) : (
              <Field
                label="Default value"
                type={form.watch("type") === "url" ? "url" : "text"}
                {...form.register("defaultValue")}
                containerClassName="mb-0"
              />
            )}
            {form.watch("type") !== "multiselect" &&
              form.watch("type") !== "enum" &&
              form.watch("type") !== "textarea" &&
              form.watch("type") !== "date" &&
              form.watch("type") !== "datetime" && (
                <Field
                  label="Placeholder"
                  {...form.register("placeholder")}
                  containerClassName="mb-0"
                  helpText="Shown inside empty input fields as placeholder text"
                />
              )}
          </>
        ) : (
          <Box>
            <Text as="label" mb="2" weight="medium">
              Default value
            </Text>
            <RadioGroup
              value={form.watch("defaultValue") ? "true" : "false"}
              setValue={(v) => form.setValue("defaultValue", v === "true")}
              options={[
                { value: "true", label: "True" },
                { value: "false", label: "False" },
              ]}
            />
          </Box>
        )}
        <Checkbox
          id={"required"}
          label="Required"
          description="Make the custom field required when creating or editing features or experiments."
          value={!!form.watch("required")}
          setValue={(value) => {
            form.setValue("required", value);
          }}
        />
        {showSearchableToggle && (
          <Checkbox
            id="index"
            label="Searchable"
            description="Make the custom field searchable."
            value={!!form.watch("index")}
            setValue={(value) => {
              form.setValue("index", value);
            }}
          />
        )}
      </Flex>
    </Modal>
  );
}
