import { FC, useState } from "react";
import {
  CreateSavedGroupProps,
  SavedGroupInterface,
  SavedGroupType,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import useMembers from "../../hooks/useMembers";
import { useAttributeSchema } from "../../services/features";
import { useDefinitions } from "../../services/DefinitionsContext";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import StringArrayField from "../Forms/StringArrayField";
import ConditionInput from "../Features/ConditionInput";

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
  type: SavedGroupType;
}> = ({ close, current, type }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();

  const attributeSchema = useAttributeSchema();

  const { mutateDefinitions } = useDefinitions();

  const [rawTextMode, setRawTextMode] = useState(false);
  const [rawText, setRawText] = useState(current.values?.join(", ") || "");

  const form = useForm<CreateSavedGroupProps>({
    defaultValues: {
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      condition: current.condition || "",
      type,
      values: current.values || [],
    },
  });

  return (
    <Modal
      close={close}
      open={true}
      size="lg"
      header={`${current.id ? "Edit" : "New"} ${
        type === "condition" ? "Condition" : "ID List"
      }`}
      submit={form.handleSubmit(async (value) => {
        if (
          type === "condition" &&
          (!value.condition || value.condition === "{}")
        ) {
          throw new Error("Must add at least 1 targeting condition");
        }

        // Update existing saved group
        if (current.id) {
          await apiCall(`/saved-groups/${current.id}`, {
            method: "PUT",
            body: JSON.stringify(value),
          });
        }
        // Create new saved group
        else {
          const payload: UpdateSavedGroupProps = {
            condition: value.condition,
            groupName: value.groupName,
            owner: value.owner,
            values: value.values,
          };
          await apiCall(`/saved-groups`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
        }
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
          value={form.watch("owner") || ""}
          onChange={(v) => form.setValue("owner", v)}
          placeholder="Optional"
          options={memberUsernameOptions.map((m) => ({
            value: m.display,
            label: m.display,
          }))}
        />
      )}
      {type === "condition" ? (
        <ConditionInput
          defaultValue={form.watch("condition") || ""}
          onChange={(v) => form.setValue("condition", v)}
        />
      ) : (
        <>
          <SelectField
            label="Attribute Key"
            required
            value={form.watch("attributeKey") || ""}
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
                form.setValue(
                  "values",
                  e.target.value.split(",").map((val) => val.trim())
                );
              }}
            />
          ) : (
            <StringArrayField
              containerClassName="mb-0"
              label="Create list of values"
              value={form.watch("values") || []}
              onChange={(values) => {
                form.setValue("values", values);
                setRawText(values.join(","));
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
        </>
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
