import { FC } from "react";
import { SavedGroupInterface } from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { useAttributeSchema } from "@/services/features";
import { useAuth } from "../../services/auth";
import useMembers from "../../hooks/useMembers";
import { useDefinitions } from "../../services/DefinitionsContext";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import ConditionInput from "../Features/ConditionInput";

function getKeyFromName(name: string) {
  return name.toLowerCase().split(/\s+/g).join("_").replace(/__*/g, "_");
}

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
  runtime: boolean;
}> = ({ close, current, runtime }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();

  const { mutateDefinitions } = useDefinitions();

  const attributes = useAttributeSchema();

  const form = useForm({
    defaultValues: {
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      id: current.id || "",
      source: runtime ? "runtime" : "inline",
      condition:
        current.condition ||
        (attributes[0]
          ? JSON.stringify({
              [attributes[0].property]: {
                $in: [],
              },
            })
          : ""),
    },
  });

  return (
    <Modal
      close={close}
      open={true}
      size="lg"
      header={`${current.id ? "Edit" : "New"} ${
        runtime ? "Runtime Group" : "Inline Group"
      }`}
      submit={form.handleSubmit(async (value) => {
        if (runtime) {
          value.source = "runtime";
          value.condition = "";

          if (!value.attributeKey) {
            value.attributeKey = getKeyFromName(value.groupName);
          }
        } else {
          value.source = "inline";
          value.attributeKey = "";
          if (!value.condition || value.condition === "{}") {
            throw new Error("Please add at least one condition");
          }
        }

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
      {current.id && (
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
      )}
      {runtime ? (
        <Field
          {...form.register("attributeKey")}
          label="Group Identifier"
          placeholder={getKeyFromName(form.watch("groupName"))}
          helpText="This is the unique group identifier you will reference in your code."
        />
      ) : (
        <ConditionInput
          defaultValue={form.watch("condition") || ""}
          onChange={(condition) => {
            form.setValue("condition", condition);
          }}
          emptyText="No conditions specified."
          title="Include all users who match the following"
          require
        />
      )}
      {current.id && (
        <div className="alert alert-warning mt-2">
          <b>Warning:</b> Updating this group will automatically update any
          feature or experiment that references it.
        </div>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
