import { SavedGroupTargeting } from "shared/types/feature";
import { PiArrowSquareOut, PiPlusCircleBold, PiXBold } from "react-icons/pi";
import React from "react";
import { Box, Text, IconButton, Separator } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import {
  TargetingConditionsCard,
  ConditionRow,
  AddConditionButton,
  ConditionRowLabel,
} from "./TargetingConditionsCard";

export interface Props {
  value: SavedGroupTargeting[];
  setValue: (savedGroups: SavedGroupTargeting[]) => void;
  project: string;
}

export default function SavedGroupTargetingField({
  value,
  setValue,
  project,
}: Props) {
  const { savedGroups, getSavedGroupById } = useDefinitions();

  const { unsupportedConnections, hasLargeSavedGroupFeature } =
    useLargeSavedGroupSupport(project);

  if (!savedGroups.length)
    return (
      <Box>
        <label>Target by Saved Groups</label>
        <Box>
          <Text color="gray" style={{ fontStyle: "italic" }} mb="2">
            You do not have any saved groups.
          </Text>
        </Box>
      </Box>
    );

  const filteredSavedGroups = savedGroups.filter((group) => {
    return (
      !project || !group.projects?.length || group.projects.includes(project)
    );
  });

  const options = filteredSavedGroups.map((s) => ({
    value: s.id,
    label: s.groupName,
  }));

  const conflicts = getSavedGroupTargetingConflicts(value);

  if (value.length === 0) {
    return (
      <Box>
        <label>Target by Saved Groups</label>
        <Box>
          <Text color="gray" style={{ fontStyle: "italic" }} mb="2">
            No saved group targeting applied.
          </Text>
          <Box mt="2">
            <Link
              onClick={() => {
                setValue([
                  ...value,
                  {
                    match: "any",
                    ids: [],
                  },
                ]);
              }}
            >
              <Text weight="bold">
                <PiPlusCircleBold className="mr-1" />
                Add group targeting
              </Text>
            </Link>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box mb="6">
      <Box>
        <label>Target by Saved Groups</label>
        <LargeSavedGroupPerformanceWarning
          hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
          unsupportedConnections={unsupportedConnections}
        />
      </Box>
      {conflicts.length > 0 && (
        <Callout status="error" mb="3">
          <Text weight="bold">Error:</Text> You have a conflict in your rules
          with the following groups:{" "}
          {conflicts.map((c) => (
            <Badge
              key={c}
              label={getSavedGroupById(c)?.groupName || c}
              color="red"
              mr="1"
            />
          ))}
        </Callout>
      )}
      <TargetingConditionsCard
        targetingType="group"
        total={value.length}
        addButton={
          <AddConditionButton
            onClick={() => {
              setValue([
                ...value,
                {
                  match: "any",
                  ids: [],
                },
              ]);
            }}
          >
            Add condition
          </AddConditionButton>
        }
      >
        <>
          {value.map((v, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <Separator
                  style={{ width: "100%", backgroundColor: "var(--slate-a3)" }}
                />
              )}
              <ConditionRow
                prefixSlot={
                  <ConditionRowLabel label={i === 0 ? "IF IN" : "AND"} />
                }
                attributeSlot={
                  <SelectField
                    useMultilineLabels={true}
                    value={v.match}
                    onChange={(match) => {
                      const newValue = [...value];
                      newValue[i] = { ...v };
                      newValue[i].match = match as "all" | "any" | "none";
                      setValue(newValue);
                    }}
                    sort={false}
                    options={[
                      { value: "any", label: "any of" },
                      { value: "all", label: "all of" },
                      { value: "none", label: "none of" },
                    ]}
                  />
                }
                valueSlot={
                  <MultiSelectField
                    value={v.ids}
                    onChange={(ids) => {
                      const newValue = [...value];
                      newValue[i] = { ...v };
                      newValue[i].ids = ids;
                      setValue(newValue);
                    }}
                    options={options}
                    formatOptionLabel={(o, meta) => {
                      if (meta.context !== "value") return o.label;
                      const group = getSavedGroupById(o.value);
                      if (!group) return o.label;
                      return (
                        <Link
                          href={`/saved-groups/${group.id}`}
                          target="_blank"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: "200px",
                            }}
                          >
                            {o.label}
                          </span>
                          <PiArrowSquareOut style={{ flexShrink: 0 }} />
                        </Link>
                      );
                    }}
                    required
                    placeholder="Select groups..."
                    closeMenuOnSelect={true}
                  />
                }
                removeSlot={
                  <Tooltip content="Remove group">
                    <IconButton
                      type="button"
                      color="gray"
                      variant="ghost"
                      radius="full"
                      size="1"
                      onClick={() => {
                        const newValue = value.filter((_, idx) => idx !== i);
                        setValue(newValue);
                      }}
                    >
                      <PiXBold size={16} />
                    </IconButton>
                  </Tooltip>
                }
              />
            </React.Fragment>
          ))}
        </>
      </TargetingConditionsCard>
    </Box>
  );
}

export function getSavedGroupTargetingConflicts(
  savedGroups: SavedGroupTargeting[],
): string[] {
  const required = new Set<string>();
  const excluded = new Set<string>();
  savedGroups.forEach((rule) => {
    if (rule.match === "all" || rule.match === "any") {
      rule.ids.forEach((id) => required.add(id));
    } else if (rule.match === "none") {
      rule.ids.forEach((id) => excluded.add(id));
    }
  });

  // If there's an overlap between required and excluded groups, there's a conflict
  return Array.from(required).filter((id) => excluded.has(id));
}

export function validateSavedGroupTargeting(
  savedGroups?: SavedGroupTargeting[],
) {
  if (!savedGroups) return;

  if (savedGroups.some((g) => g.ids.length === 0)) {
    throw new Error("Cannot have empty Saved Group targeting rules.");
  }

  if (getSavedGroupTargetingConflicts(savedGroups).length > 0) {
    throw new Error(
      "Please fix conflicts in your Saved Group rules before saving",
    );
  }
}
