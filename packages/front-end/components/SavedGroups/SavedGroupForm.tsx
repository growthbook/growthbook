import { FC, useEffect, useState } from "react";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import {
  isIdListSupportedDatatype,
  validateAndFixCondition,
} from "shared/util";
import { FaPlusCircle } from "react-icons/fa";
import { SavedGroupInterface, SavedGroupType } from "shared/src/types";
import clsx from "clsx";
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
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import MultiSelectField from "@/components/Forms/MultiSelectField";

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

  const { projects, project } = useDefinitions();

  const [errorMessage, setErrorMessage] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);

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
      projects: current.projects || (project ? [project] : []),
    },
  });

  const projectsOptions = projects.map((p) => ({
    label: p.name,
    value: p.id,
  }));

  const isValid =
    !!form.watch("groupName") &&
    (type === "list"
      ? !!form.watch("attributeKey")
      : !!form.watch("condition"));

  return upgradeModal ? (
    <UpgradeModal
      close={() => setUpgradeModal(false)}
      reason=""
      source="large-saved-groups"
    />
  ) : (
    <Modal
      trackingEventModalType="saved-group-form"
      close={close}
      open={true}
      size="lg"
      header={`${current.id ? "Edit" : "Add"} ${
        type === "condition" ? "Condition Group" : "ID List"
      }`}
      cta={current.id ? "Save" : "Submit"}
      ctaEnabled={isValid}
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
            projects: value.projects,
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
      <MultiSelectField
        label="Projects"
        labelClassName="font-weight-bold"
        placeholder="All Projects"
        value={form.watch("projects") || []}
        onChange={(projects) => form.setValue("projects", projects)}
        options={projectsOptions}
        sort={false}
        closeMenuOnSelect={true}
      />
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
      {type === "condition" ? (
        <ConditionInput
          defaultValue={form.watch("condition") || ""}
          onChange={(v) => form.setValue("condition", v)}
          key={conditionKey}
          project={""}
          emptyText="No conditions specified."
          title="Include all users who match the following"
          require
        />
      ) : (
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
            isOptionDisabled={({ label }) => {
              const attr = attributeSchema.find(
                (attr) => attr.property === label
              );
              if (!attr) return false;
              return !isIdListSupportedDatatype(attr.datatype);
            }}
            formatOptionLabel={({ label }) => {
              const attr = attributeSchema.find(
                (attr) => attr.property === label
              );
              if (!attr) return label;
              const unsupported = !isIdListSupportedDatatype(attr.datatype);
              return (
                <div className={clsx(unsupported ? "disabled" : "")}>
                  {label}
                  {unsupported && (
                    <span className="float-right">
                      <Tooltip
                        body="The datatype for this attribute key isn't valid for ID Lists. Try using a Condition Group instead"
                        tipPosition="top"
                      >
                        unsupported datatype
                      </Tooltip>
                    </span>
                  )}
                </div>
              );
            }}
            helpText={current.attributeKey && "This field cannot be edited."}
          />
          {!current.id && (
            <IdListItemInput
              values={form.watch("values") || []}
              setValues={(newValues) => {
                form.setValue("values", newValues);
              }}
              openUpgradeModal={() => setUpgradeModal(true)}
            />
          )}
        </>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
