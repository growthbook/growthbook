import { FC, useState } from "react";
import { SavedGroupInterface } from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { useAuth } from "../services/auth";
import useMembers from "../hooks/useMembers";
import { useAttributeSchema } from "../services/features";
import { useDefinitions } from "../services/DefinitionsContext";
import Modal from "./Modal";
import Field from "./Forms/Field";
import SelectField from "./Forms/SelectField";
import StringArrayField from "./Forms/StringArrayField";

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();

  const attributeSchema = useAttributeSchema();

  const { mutateDefinitions } = useDefinitions();

  const [rawTextMode, setRawTextMode] = useState(false);
  const [rawText, setRawText] = useState(current.values?.join(", ") || "");

  const form = useForm({
    defaultValues: {
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      groupList: current.values || [],
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
      {rawTextMode ? (
        <Field
          containerClassName="mb-0"
          label="Create list of comma separated values"
          required
          textarea
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            form.setValue("groupList", e.target.value.trim().split(","));
          }}
        />
      ) : (
        <StringArrayField
          containerClassName="mb-0"
          label="Create list of values"
          value={form.watch("groupList")}
          onChange={(values) => {
            form.setValue("groupList", values);
            setRawText(values.join(", "));
          }}
          placeholder="Enter some values..."
          delimiters={["Enter", "Tab"]}
        />
      )}
      <a
        className="d-flex flex-column align-items-end"
        href="#"
        style={{ fontSize: "0.8em" }}
        onClick={(e) => {
          e.preventDefault();
          setRawTextMode((prev) => !prev);
        }}
      >
        Switch to {rawTextMode ? "token" : "raw text"} mode
      </a>
      {current.id && (
        <div className="alert alert-warning mt-2">
          <b>Warning:</b> Updating this group will automatically update any
          feature that has an override rule that uses this group.
        </div>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
