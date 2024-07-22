import { FC, useEffect, useState } from "react";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { SMALL_GROUP_SIZE_LIMIT, validateAndFixCondition } from "shared/util";
import { FaPlusCircle } from "react-icons/fa";
import { SavedGroupInterface, SavedGroupType } from "shared/src/types";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import useMembers from "@/hooks/useMembers";
import { useAttributeSchema } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import ConditionInput from "@/components/Features/ConditionInput";
import { IdListItemInput } from "@/components/SavedGroups/IdListItemInput";

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
  type: SavedGroupType;
}> = ({ close, current, type }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();

  const [conditionKey, forceConditionRender] = useIncrementer();

  const attributeSchema = useAttributeSchema();

  const { mutateDefinitions } = useDefinitions();

  const [errorMessage, setErrorMessage] = useState("");
  const [showDescription, setShowDescription] = useState(false);

  useEffect(() => {
    if (current.description) {
      setShowDescription(true);
    }
  }, [current]);

  const form = useForm<CreateSavedGroupProps>({
    defaultValues: {
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      condition: current.condition || "",
      type,
      values: current.values || [],
      description: current.description || "",
      passByReferenceOnly: current.passByReferenceOnly || false,
    },
  });

  const [disableSubmit, setDisableSubmit] = useState(false);

  const [
    attributeTargetingSdkIssues,
    setAttributeTargetingSdkIssues,
  ] = useState(false);

  const isValid =
    !!form.watch("groupName") &&
    (type === "list"
      ? !!form.watch("attributeKey")
      : !!form.watch("condition"));

  return (
    <Modal
      close={close}
      open={true}
      size="lg"
      header={`${current.id ? "Edit" : "Add"} ${
        type === "condition" ? "Condition Group" : "ID List"
      }`}
      cta={current.id ? "Save" : "Submit"}
      ctaEnabled={isValid && !disableSubmit && !attributeTargetingSdkIssues}
      submit={form.handleSubmit(async (value) => {
        if (type === "condition") {
          const conditionRes = validateAndFixCondition(value.condition, (c) => {
            form.setValue("condition", c);
            forceConditionRender();
          });
          if (conditionRes.empty) {
            throw new Error("Condition cannot be empty");
          }
        }

        // Update existing saved group
        if (current.id) {
          const payload: UpdateSavedGroupProps = {
            condition: value.condition,
            groupName: value.groupName,
            owner: value.owner,
            values: value.values,
            description: value.description,
            passByReferenceOnly: value.passByReferenceOnly,
          };
          await apiCall(`/saved-groups/${current.id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
        }
        // Create new saved group
        else {
          const payload: CreateSavedGroupProps = {
            ...value,
          };
          setErrorMessage("");
          await apiCall(
            `/saved-groups`,
            {
              method: "POST",
              body: JSON.stringify(payload),
            },
            (responseData) => {
              if (responseData.status === 413) {
                setErrorMessage(
                  "Cannot import such a large CSV. Try again with a smaller payload"
                );
              }
            }
          );
        }
        mutateDefinitions({});
      })}
      error={errorMessage}
    >
      {current.type === "condition" && (
        <div className="form-group">
          Updating this group will automatically update any associated Features
          and Experiments.
        </div>
      )}
      <Field
        label={`${type === "list" ? "List" : "Group"} Name`}
        labelClassName="font-weight-bold"
        required
        {...form.register("groupName")}
        placeholder="e.g. beta-users or internal-team-members"
      />
      {showDescription ? (
        <Field
          label="Description"
          labelClassName="font-weight-bold"
          required={false}
          textarea
          maxLength={100}
          value={form.watch("description")}
          onChange={(e) => {
            form.setValue("description", e.target.value);
          }}
        />
      ) : (
        <p
          className="cursor-pointer text-color-primary"
          onClick={() => setShowDescription(true)}
        >
          <FaPlusCircle /> Add a description
        </p>
      )}
      {current.id && (
        <SelectField
          label="Owner"
          labelClassName="font-weight-bold"
          value={form.watch("owner") || ""}
          onChange={(v) => form.setValue("owner", v)}
          placeholder="Optional"
          options={memberUsernameOptions.map((m) => ({
            value: m.display,
            label: m.display,
          }))}
        />
      )}
      {type === "condition" && (
        <ConditionInput
          defaultValue={form.watch("condition") || ""}
          onChange={(v) => form.setValue("condition", v)}
          key={conditionKey}
          project={""}
          emptyText="No conditions specified."
          title="Include all users who match the following"
          require
          setAttributeTargetingSdkIssues={setAttributeTargetingSdkIssues}
        />
      )}
      {type === "list" && (
        <>
          <SelectField
            label="Attribute Key"
            labelClassName="font-weight-bold"
            required
            value={form.watch("attributeKey") || ""}
            disabled={!!current.attributeKey}
            onChange={(v) => form.setValue("attributeKey", v)}
            placeholder="Choose one..."
            options={attributeSchema.map((a) => ({
              value: a.property,
              label: a.property,
            }))}
            helpText={current.attributeKey && "This field cannot be edited."}
          />
          <IdListItemInput
            values={form.watch("values") || []}
            passByReferenceOnly={current?.passByReferenceOnly || false}
            bypassSmallListSizeLimit={
              (current?.values || []).length > SMALL_GROUP_SIZE_LIMIT &&
              !current?.passByReferenceOnly
            }
            setValues={(newValues) => {
              form.setValue("values", newValues);
            }}
            setPassByReferenceOnly={(passByReferenceOnly) =>
              form.setValue("passByReferenceOnly", passByReferenceOnly)
            }
            disableSubmit={disableSubmit}
            setDisableSubmit={setDisableSubmit}
          />
        </>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
