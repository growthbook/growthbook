import { FC, useMemo } from "react";
import { SavedGroupInterface } from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { isLegacySavedGroup } from "shared/util";
import { FaQuestionCircle } from "react-icons/fa";
import { useAttributeSchema } from "@/services/features";
import { SavedGroupUsageList, SavedGroupUsageRef } from "@/pages/saved-groups";
import { useAuth } from "../../services/auth";
import useMembers from "../../hooks/useMembers";
import { useDefinitions } from "../../services/DefinitionsContext";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import ConditionInput from "../Features/ConditionInput";
import Tooltip from "../Tooltip/Tooltip";

function getKeyFromName(name: string) {
  return name.toLowerCase().split(/\s+/g).join("_").replace(/__*/g, "_");
}

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
  runtime: boolean;
  legacyTargetingUsage: SavedGroupUsageRef[];
}> = ({ close, current, runtime, legacyTargetingUsage }) => {
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

  const condition = form.watch("condition");
  const isNoLongerLegacy = useMemo(() => {
    // Only relevant for existing inline groups
    if (
      !current.id ||
      !current.attributeKey ||
      !current.condition ||
      current.source !== "inline"
    ) {
      return false;
    }

    // Only a problem if we're going from containing legacy values to not containing any values
    if (!isLegacySavedGroup(current.condition, current.attributeKey)) {
      return false;
    }

    return !isLegacySavedGroup(condition, current.attributeKey);
  }, [condition, current]);

  return (
    <Modal
      close={close}
      open={true}
      size="lg"
      header={`${current.id ? "Edit" : "New"} ${
        runtime ? "Runtime Group" : "Inline Group"
      }`}
      ctaEnabled={!(isNoLongerLegacy && legacyTargetingUsage.length > 0)}
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
      {isNoLongerLegacy && legacyTargetingUsage.length > 0 ? (
        <div className="alert alert-danger mt-2">
          <Tooltip
            body={
              <>
                <p>
                  This Saved Group is referenced in a{" "}
                  <strong>Target by Attribute</strong> field, which only
                  supports simple lists of values. To use more complex targeting
                  conditions, you must switch to the newer and more flexible{" "}
                  <strong>Target by Saved Group</strong> field instead.
                </p>

                <p>
                  If you prefer to remain backwards compatible, you must select
                  the <code>{current.attributeKey || ""}</code> attribute and{" "}
                  <code>is in the list</code> operator without any extra
                  conditions applied.
                </p>
              </>
            }
          >
            <b>
              Warning: Backwards Incompatible Change <FaQuestionCircle />
            </b>
          </Tooltip>
          . Must update the following features and experiments before saving:
          <div className="mt-1">
            <SavedGroupUsageList usage={legacyTargetingUsage} />
          </div>
        </div>
      ) : current.id ? (
        <div className="alert alert-info mt-2">
          <b>Notice:</b> Saving this form will immediately update any live
          feature or experiment that references this Saved Group.
        </div>
      ) : null}
    </Modal>
  );
};
export default SavedGroupForm;
