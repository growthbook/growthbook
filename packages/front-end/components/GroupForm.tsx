import { FC } from "react";
import { GroupInterface } from "back-end/types/group";
import { useForm } from "react-hook-form";
import { useAuth } from "../services/auth";
import useMembers from "../hooks/useMembers";
import { useDefinitions } from "../services/DefinitionsContext";
import Modal from "./Modal";
import Field from "./Forms/Field";
import SelectField from "./Forms/SelectField";
import { useAttributeSchema } from "../services/features";

const GroupForm: FC<{
  close: () => void;
  current: Partial<GroupInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();

  const { mutateDefinitions } = useDefinitions();

  const attributeSchema = useAttributeSchema();

  const form = useForm({
    defaultValues: {
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      groupList: current.group || "",
    },
  });

  return (
    <Modal
      close={close}
      open={true}
      header={current.groupName ? "Edit Group" : "New Group"}
      submit={form.handleSubmit(async (value) => {
        await apiCall("/groups", {
          method: current.groupName ? "PUT" : "POST",
          body: JSON.stringify(value),
        });
        await mutateDefinitions({});
      })}
    >
      <Field
        label="Group Name"
        required
        {...form.register("groupName")}
        helpText="e.g. beta users" //TODO: Come back and figure out how to get this to be previewText instead
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
        onChange={(v) => form.setValue("attributeKey", v)}
        placeholder="Choose one..."
        options={attributeSchema.map((a) => ({
          value: a.property,
          label: a.property,
        }))}
      />
      <Field
        label="Create list of comma separated values"
        required
        textarea
        {...form.register("groupList")}
      />
    </Modal>
  );
};
export default GroupForm;
