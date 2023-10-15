import { FC, useState } from "react";
import {
  SavedGroupInterface,
  SavedGroupSource,
} from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { useAuth } from "../services/auth";
import useMembers from "../hooks/useMembers";
import { useAttributeSchema } from "../services/features";
import { useDefinitions } from "../services/DefinitionsContext";
import Modal from "./Modal";
import Field from "./Forms/Field";
import SelectField from "./Forms/SelectField";
import StringArrayField from "./Forms/StringArrayField";
import ButtonSelectField from "./Forms/ButtonSelectField";
import Tooltip from "./Tooltip/Tooltip";
import Code from "./SyntaxHighlighting/Code";

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
  const [exampleOpen, setExampleOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      groupList: current.values || [],
      id: current.id || "",
      source: current.source || "inline",
    },
  });

  return (
    <Modal
      close={close}
      open={true}
      size="lg"
      header={current.id ? "Edit Group" : "New Group"}
      submit={form.handleSubmit(async (value) => {
        if (value.source === "runtime") {
          value.groupList = [];
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
      {!current.id && (
        <ButtonSelectField
          value={form.watch("source")}
          setValue={(value) => {
            form.setValue("source", value as SavedGroupSource);
            form.setValue(
              "attributeKey",
              value === "runtime" ? form.watch("groupName") : ""
            );
          }}
          options={[
            { label: "Inline", value: "inline" },
            { label: "At Runtime", value: "runtime" },
          ]}
          label={
            <>
              How do you want to define the users in your group?{" "}
              <Tooltip
                body={
                  <>
                    <p>
                      <strong>Inline</strong>: Pick a targeting attribute and
                      enter a list of values directly in the GrowthBook UI
                    </p>
                    <p>
                      <strong>At Runtime</strong>: Your application determines
                      group membership at runtime and passes the result into the
                      GrowthBook SDK
                    </p>
                  </>
                }
              />
            </>
          }
        />
      )}
      {form.watch("source") === "runtime" ? (
        <>
          <Field
            {...form.register("attributeKey")}
            label="Group Key"
            helpText="This is the unique group identifier you will use in your code. It cannot be changed later."
          />
          <div className="alert alert-info">
            <strong>Note:</strong> Using a Runtime Group requires making changes
            to your GrowthBook SDK implementation.{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setExampleOpen(!exampleOpen);
              }}
            >
              {exampleOpen ? "hide" : "show"} example
            </a>
            {exampleOpen && (
              <Code
                language="javascript"
                code={`
function getGroups(attributes) {
  const groups = [];
  // TODO: actual logic for determining if user is in this group
  if (true) {
    groups.push(${JSON.stringify(form.watch("attributeKey"))});
  }
  return groups;
}

const growthbook = new GrowthBook({
  ... // other settings
  getGroups: getGroups
})
            `.trim()}
              />
            )}
          </div>
        </>
      ) : (
        <>
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
                form.setValue(
                  "groupList",
                  e.target.value.split(",").map((val) => val.trim())
                );
              }}
            />
          ) : (
            <StringArrayField
              containerClassName="mb-0"
              label="Create list of values"
              value={form.watch("groupList")}
              onChange={(values) => {
                form.setValue("groupList", values);
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
      {current.id && current.source !== "runtime" && (
        <div className="alert alert-warning mt-2">
          <b>Warning:</b> Updating this group will automatically update any
          feature that has an override rule that uses this group.
        </div>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
