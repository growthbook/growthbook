import { useForm } from "react-hook-form";
import { CustomField, CustomFieldTypes } from "back-end/types/organization";
import uniqid from "uniqid";
import React from "react";
import { useAuth } from "@/services/auth";
import { useCustomFields } from "@/services/experiments";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Modal from "../Modal";
import Field from "../Forms/Field";
import Toggle from "../Forms/Toggle";
import SelectField, { GroupedValue, SingleValue } from "../Forms/SelectField";
import track from "../../services/track";

export default function CustomFieldModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<CustomField>;
  close: () => void;
  onSuccess?: () => void;
}) {
  const { project, projects } = useDefinitions();
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const form = useForm<Partial<CustomField>>({
    defaultValues: {
      id: existing.id || uniqid("field_"),
      name: existing.name || "",
      values: existing.values || "",
      type: existing.type || "text",
      section: "experiment", // not supporting features yet
      projects: existing.projects || [project] || [],
      required: existing.required ?? false,
      dateCreated:
        existing.dateCreated || new Date().toISOString().substr(0, 16),
      active: true,
      index: true,
    },
  });

  const customFields = useCustomFields() ?? [];

  const fieldOptions = [
    "text",
    "textarea",
    "markdown",
    "enum",
    "multiselect",
    "boolean",
  ];

  const availableProjects: (SingleValue | GroupedValue)[] = projects
    .slice()
    .sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1))
    .map((p) => ({ value: p.id, label: p.name }));

  return (
    <Modal
      open={true}
      close={close}
      header={
        existing.id
          ? `Edit ${existing.id} Custom Field`
          : "Create New Custom Field"
      }
      submit={form.handleSubmit(async (value) => {
        const newCustomFields = [...customFields];
        if (existing.id) {
          const edit = newCustomFields.filter((e) => e.id === existing.id)[0];
          if (!edit) throw new Error("Could not edit custom field");
          edit.name = value.name;
          edit.type = value.type;
          edit.required = value.required;
          edit.values = value.values;
          edit.description = value.description;
          edit.projects = value.projects;
        } else {
          newCustomFields.push({
            id: value.id.toLowerCase(),
            name: value.name,
            values: value.values,
            description: value.description,
            placeholder: value.placeholder,
            projects: value.projects,
            type: value.type,
            required: value.required,
            creator: userId,
            dateCreated: value.dateCreated,
            active: value.active,
          });
        }

        // Add/edit environment
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: {
              customFields: newCustomFields,
            },
          }),
        });

        track("Create Custom Experiment Field", {
          type: value.type,
        });

        if (onSuccess) {
          await onSuccess();
        }
      })}
    >
      <Field
        label="Name"
        {...form.register("name")}
        placeholder=""
        required={true}
      />
      <div className="mb-3">
        <SelectField
          label="Type"
          value={form.watch("type")}
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
      <Field label="Description" {...form.register("description")} />
      <div className="form-group mb-3 mt-3">
        {projects?.length && (
          <div className="form-group">
            <label>Projects (optional)</label>
            <MultiSelectField
              value={form.watch("projects")}
              name="projects"
              options={availableProjects}
              onChange={(v) => {
                form.setValue("projects", v);
              }}
              className="label-overflow-ellipsis"
              helpText="Restrict this field to only experiments in a specific project"
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
        <label htmlFor="required">Field is required for new experiments</label>
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
