import { useForm } from "react-hook-form";
import {
  CustomField,
  CustomFieldSection,
  CustomFieldTypes,
} from "back-end/types/custom-fields";
import uniqid from "uniqid";
import React from "react";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import track from "@/services/track";
import { useCustomFields } from "@/hooks/useCustomFields";
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "../Modal";
import Field from "../Forms/Field";
import Toggle from "../Forms/Toggle";
import SelectField, { GroupedValue, SingleValue } from "../Forms/SelectField";

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
      id: existing.id || uniqid("cfl_"),
      name: existing.name || "",
      description: existing.description || "",
      values: existing.values || "",
      type: existing.type || "text",
      placeholder: existing.placeholder || "",
      defaultValue: existing.defaultValue
        ? existing.defaultValue
        : existing.type === "boolean"
        ? existing.defaultValue ?? false
        : "",
      section: existing.section || section,
      projects: existing.projects || [project] || [],
      required: existing.required ?? false,
      dateCreated:
        existing.dateCreated || new Date().toISOString().substr(0, 16),
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

  return (
    <Modal
      open={true}
      close={close}
      header={existing.id ? `Edit Custom Field` : "Create New Custom Field"}
      submit={form.handleSubmit(async (value) => {
        if (value.type === "boolean") {
          // make sure the default value is a boolean
          value.defaultValue = !!value.defaultValue;
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
          edit.section = section;

          await apiCall(`/custom-fields/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(edit),
          });

          track("Edit Custom Experiment Field", {
            type: value.type,
          });
        } else {
          const newCustomFields: Partial<CustomField> = {
            name: value.name ?? "",
            values: value.values,
            description: value.description ?? "",
            placeholder: value.placeholder ?? "",
            defaultValue: value.defaultValue,
            projects: value.projects,
            type: value.type ?? "text",
            required: value.required ?? false,
            section: section,
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
        label="Name"
        {...form.register("name")}
        placeholder=""
        required={true}
      />
      <Field label="Description" {...form.register("description")} />
      <div className="mb-3">
        <SelectField
          label="Type"
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
        <>
          <label className="mr-2">Default value</label>
          <Toggle
            id={"defaultValue"}
            label="Default value"
            value={!!form.watch("defaultValue")}
            setValue={(value) => {
              form.setValue("defaultValue", value);
            }}
          />
        </>
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
      <div className="mb-3 mt-3">
        <Toggle
          id={"required"}
          label="Required"
          value={!!form.watch("required")}
          setValue={(value) => {
            form.setValue("required", value);
          }}
        />{" "}
        <label htmlFor="required">
          Field is required on new experiments{" "}
          <Tooltip
            body={
              "This will make the custom field required when creating or editing experiments. You can also make this field required before starting an experiment from launch checklists."
            }
          ></Tooltip>
        </label>
      </div>
      <Toggle
        id={"index"}
        label="Index"
        value={!!form.watch("index")}
        setValue={(value) => {
          form.setValue("index", value);
        }}
      />{" "}
      <label htmlFor="index">Make this field searchable</label>
    </Modal>
  );
}
