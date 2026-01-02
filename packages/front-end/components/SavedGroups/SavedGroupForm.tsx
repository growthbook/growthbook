import { FC, useEffect, useMemo, useState } from "react";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
} from "shared/types/saved-group";
import { useForm } from "react-hook-form";
import {
  isIdListSupportedAttribute,
  validateAndFixCondition,
} from "shared/util";
import { PiPlus } from "react-icons/pi";
import { SavedGroupInterface, SavedGroupType } from "shared/types/groups";
import clsx from "clsx";
import { Flex, Text } from "@radix-ui/themes";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
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
import useOrgSettings from "@/hooks/useOrgSettings";
import Link from "@/ui/Link";
import SelectOwner from "../Owner/SelectOwner";

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
  type: SavedGroupType;
}> = ({ close, current, type }) => {
  const { apiCall } = useAuth();
  const { savedGroupSizeLimit } = useOrgSettings();

  const [conditionKey, forceConditionRender] = useIncrementer();

  const attributeSchema = useAttributeSchema();

  const { mutateDefinitions, savedGroups } = useDefinitions();

  const { projects, project } = useDefinitions();

  const [errorMessage, setErrorMessage] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [adminBypassSizeLimit, setAdminBypassSizeLimit] = useState(false);

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

  const listAboveSizeLimit = savedGroupSizeLimit
    ? (form.watch("values") ?? []).length > savedGroupSizeLimit
    : false;
  const isValid =
    !!form.watch("groupName") &&
    (type === "list"
      ? !!form.watch("attributeKey") &&
        (!listAboveSizeLimit || adminBypassSizeLimit)
      : !!form.watch("condition"));

  // Create a Map from saved groups for cycle detection
  const groupMap = useMemo(
    () => new Map(savedGroups.map((group) => [group.id, group])),
    [savedGroups],
  );

  return upgradeModal ? (
    <UpgradeModal
      close={() => setUpgradeModal(false)}
      source="large-saved-groups"
      commercialFeature="large-saved-groups"
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
          const conditionRes = validateAndFixCondition(
            value.condition,
            (c) => {
              form.setValue("condition", c);
              forceConditionRender();
            },
            true,
            groupMap,
          );
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
                  "Cannot import such a large CSV. Try again with a smaller payload",
                );
              }
            },
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
        <Link
          onClick={(e) => {
            e.preventDefault();
            setShowDescription(true);
          }}
          mb="5"
        >
          <Flex align="center" gap="1">
            <PiPlus />
            <Text weight="medium">Add a description</Text>
          </Flex>
        </Link>
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
        <SelectOwner
          resourceType="savedGroup"
          placeholder="Optional"
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
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
          allowNestedSavedGroups={true}
          excludeSavedGroupId={current.id}
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
                (attr) => attr.property === label,
              );
              if (!attr) return false;
              return !isIdListSupportedAttribute(attr);
            }}
            sort={false}
            formatOptionLabel={({ label }) => {
              const attr = attributeSchema.find(
                (attr) => attr.property === label,
              );
              if (!attr) return label;
              const unsupported = !isIdListSupportedAttribute(attr);
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
              listAboveSizeLimit={listAboveSizeLimit}
              bypassSizeLimit={adminBypassSizeLimit}
              setBypassSizeLimit={setAdminBypassSizeLimit}
              projects={form.watch("projects")}
            />
          )}
        </>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
