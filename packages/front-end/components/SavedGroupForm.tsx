import { FC } from "react";
import { SavedGroupInterface } from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { useAuth } from "../services/auth";
import useMembers from "../hooks/useMembers";
import { useAttributeSchema } from "../services/features";
import { useDefinitions } from "../services/DefinitionsContext";
import Modal from "./Modal";
import Field from "./Forms/Field";
import SelectField from "./Forms/SelectField";

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();

  const attributeSchema = useAttributeSchema();

  const { mutateDefinitions } = useDefinitions();

  const form = useForm({
    defaultValues: {
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      groupList: current.values?.join(", ") || "",
      id: current.id || "",
    },
  });

  return (
    <Modal
      close={close}
      open={true}
      header={current.id ? "Edit Group" : "New Group"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(
          current.id ? `/saved-groups/${current.id}` : `/saved-groups`,
          {
            method: current.id ? "PUT" : "POST",
            body: JSON.stringify(value),
          }
        );
        mutateDefinitions({});
      })}
    >
      <Field
        label="Group Name"
        required
        {...form.register("groupName")}
        placeholder="e.g. beta-users or internal-team-members"
      />
      <SelectField
        label="Owner"
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
        placeholder="Optional"
        options={memberUsernameOptions.map((m) => ({
          value: m.display,
          label: m.display,
        }))}
      />
      <SelectField
        label="Attribute Key"
        required
        value={form.watch("attributeKey")}
        disabled={!!current.attributeKey}
        onChange={(v) => form.setValue("attributeKey", v)}
        placeholder="Choose one..."
        options={attributeSchema.map((a) => ({
          value: a.property,
          label: a.property,
        }))}
        helpText={current.attributeKey && "This field can not be edited."}
      />
      <Field
        label="Create list of comma separated values"
        required
        textarea
        {...form.register("groupList")}
      />
      {current.id && (
        <div className="alert alert-warning">
          <b>Warning:</b> Updating this group will automatically update any
          feature that has an override rule that uses this group.
        </div>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
