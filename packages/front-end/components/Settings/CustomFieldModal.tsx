import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import { CustomField } from "back-end/types/organization";
import { useCustomFields } from "../../services/experiments";
import useUser from "../../hooks/useUser";
import Toggle from "../Forms/Toggle";
import uniqid from "uniqid";
import SelectField from "../Forms/SelectField";

export default function CustomFieldModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<CustomField>;
  close: () => void;
  onSuccess?: () => void;
}) {
  const form = useForm<Partial<CustomField>>({
    defaultValues: {
      id: existing.id || uniqid("field_"),
      name: existing.name || "",
      type: existing.type || "text",
      required: existing.required ?? false,
      dateCreated:
        existing.dateCreated || new Date().toISOString().substr(0, 16),
      active: true,
      index: true,
    },
  });
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const customFields = useCustomFields() ?? [];

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
        } else {
          newCustomFields.push({
            id: value.id.toLowerCase(),
            name: value.name,
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

        if (onSuccess) {
          await onSuccess();
        }
      })}
    >
      <Field label="Name" {...form.register("name")} placeholder="" />
      <SelectField
        value={form.watch("type")}
        options={[
          { label: "text", value: "text" },
          { label: "textarea", value: "textarea" },
        ]}
        onChange={(v) => {
          if (v === "text" || v === "textarea") {
            form.setValue("type", v);
          }
        }}
      />
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
