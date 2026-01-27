import { useForm } from "react-hook-form";
import {
  CustomField,
  CustomFieldSection,
  CustomFieldTypes,
} from "shared/types/custom-fields";
import React from "react";
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
import Checkbox from "@/ui/Checkbox";

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

  const form = useForm<Partial<CustomField>>({
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
      section: existing.section || section,
      projects: existing.projects || (project ? [project] : []),
      required: existing.required ?? false,
      index: true,
    },
  });
  const customFields = useCustomFields();

  const fieldOptions = [
    "text",
    "textarea",
    "markdown",
    "enum",
    "multiselect",
    "boolean",
    "url",
    "date",
  ];

  const availableProjects: (SingleValue | GroupedValue)[] = projects
    .slice()
    .sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1))
    .map((p) => ({ value: p.id, label: p.name }));

  const showSearchableToggle = false;
  return (
    <Modal
      trackingEventModalType={"custom-field"}
      open={true}
      close={close}
      header={existing.id ? `Edit Custom Field` : "Create New Custom Field"}
      cta={"Save"}
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
        const sectionValue = (value.section ?? section) as CustomFieldSection;
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
          edit.section = sectionValue;

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
            section: sectionValue,
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
      <Field
        label="Key"
        {...form.register("id")}
        pattern="^[a-z0-9_-]+$"
        placeholder=""
        required={true}
        title="Only lowercase letters, digits, underscores, and hyphens allowed. No spaces."
        helpText={
          <>
            Only lowercase letters, digits, underscores, and hyphens allowed. No
            spaces. <strong>Cannot be changed later!</strong>
          </>
        }
        disabled={!!existing.id}
      />
      <Field
        label="Name"
        {...form.register("name")}
        placeholder=""
        required={true}
      />
      <div className="mb-3">
        <SelectField
          label="Applies to"
          value={form.watch("section") ?? section}
          options={[
            { label: "Feature", value: "feature" },
            { label: "Experiment", value: "experiment" },
          ]}
          onChange={(v: CustomFieldSection) => {
            form.setValue("section", v);
          }}
        />
        <small className="text-gray">
          Whether this field is used on feature flags or experiments
        </small>
      </div>
      <Field
        label="Description"
        {...form.register("description")}
        helpText="Shown as a tool tip to users entering this field value"
      />
      <div className="mb-3">
        <SelectField
          label="Value type"
          value={form.watch("type") ?? "text"}
          options={fieldOptions.map((o) => ({ label: o, value: o }))}
          onChange={(v: CustomFieldTypes) => {
            form.setValue("type", v);
          }}
        />
      </div>
      {(form.watch("type") === "enum" ||
        form.watch("type") === "multiselect") && (
        <div className="mb-3">
          <Field
            textarea
            label="Values"
            value={form.watch("values")}
            onChange={(e) => {
              const valueStr: string = e.target.value;
              form.setValue("values", valueStr);
            }}
            name="value"
            minRows={1}
            containerClassName=""
            helpText="separate values by comma"
          />
        </div>
      )}
      {form.watch("type") !== "boolean" ? (
        <>
          {form.watch("type") !== "date" ? (
            <Field
              label="Default value"
              type={form.watch("type") === "url" ? "url" : "text"}
              {...form.register("defaultValue")}
            />
          ) : (
            <></>
          )}
          {form.watch("type") !== "multiselect" &&
            form.watch("type") !== "enum" &&
            form.watch("type") !== "textarea" && (
              <Field label="Placeholder" {...form.register("placeholder")} />
            )}
        </>
      ) : (
        <Checkbox
          id={"defaultValue"}
          label="Default value"
          description="If checked, it defaults to true. Otherwise, it defaults to false."
          value={!!form.watch("defaultValue")}
          setValue={(value) => {
            form.setValue("defaultValue", value);
          }}
        />
      )}
      <div className="form-group mb-3 mt-3">
        {projects?.length > 0 && (
          <div className="form-group">
            <label>Projects (optional)</label>
            <MultiSelectField
              value={form.watch("projects") ?? []}
              name="projects"
              options={availableProjects}
              onChange={(v) => {
                form.setValue("projects", v);
              }}
              className="label-overflow-ellipsis"
              helpText="Restrict this field to specific project"
            />
          </div>
        )}
      </div>
      {(form.watch("section") ?? section) === "experiment" && (
        <div className="mb-3 mt-3">
          <Checkbox
            id={"required"}
            label="Required"
            description="Make the custom field required when creating or editing experiments. You can also make this field required before starting an experiment from launch checklists."
            value={!!form.watch("required")}
            setValue={(value) => {
              form.setValue("required", value);
            }}
          />
        </div>
      )}
      {showSearchableToggle && (
        <>
          <Checkbox
            id="index"
            label="Searchable"
            description="Make the custom field searchable."
            value={!!form.watch("index")}
            setValue={(value) => {
              form.setValue("index", value);
            }}
          />
        </>
      )}
    </Modal>
  );
}
