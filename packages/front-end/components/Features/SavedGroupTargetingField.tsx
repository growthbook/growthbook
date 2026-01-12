import { SavedGroupTargeting } from "shared/types/feature";
import {
  PiArrowSquareOut,
  PiPlusBold,
  PiPlusCircleBold,
  PiXBold,
} from "react-icons/pi";
import React from "react";
import { Box, Flex, Text, IconButton } from "@radix-ui/themes";
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
import { ConditionLabel } from "./ConditionInput";

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
        <Text color="gray" style={{ fontStyle: "italic" }} mt="2">
          You do not have any saved groups.
        </Text>
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
    <Box my="4">
      <label>Target by Saved Groups</label>
      <Box mb="2">
        <LargeSavedGroupPerformanceWarning
          hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
          unsupportedConnections={unsupportedConnections}
        />
      </Box>
      <Box className="appbox bg-light px-3 py-3">
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
        {value.map((v, i) => {
          return (
            <Flex key={i} gap="2" align="start" mb="4">
              <Box style={{ flexShrink: 0 }}>
                <ConditionLabel label={i === 0 ? "In" : "AND"} />
              </Box>
              <Flex
                align="start"
                gap="2"
                wrap="wrap"
                style={{ flex: "1 1 0", minWidth: 0 }}
              >
                <Box style={{ minWidth: 200, flex: "1 1 0" }}>
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
                      {
                        value: "any",
                        label: "Any of",
                      },
                      {
                        value: "all",
                        label: "All of",
                      },
                      {
                        value: "none",
                        label: "None of",
                      },
                    ]}
                  />
                </Box>
                <Box style={{ minWidth: 200, flex: "1 1 0" }}>
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
                        >
                          {o.label} <PiArrowSquareOut />
                        </Link>
                      );
                    }}
                    required
                    placeholder="Select groups..."
                    closeMenuOnSelect={true}
                  />
                </Box>
              </Flex>
              <Box px="1" pt="3" style={{ width: 16 }}>
                <Tooltip content="Remove condition">
                  <IconButton
                    type="button"
                    color="red"
                    variant="ghost"
                    onClick={() => {
                      const newValue = [...value];
                      newValue.splice(i, 1);
                      setValue(newValue);
                    }}
                  >
                    <PiXBold size={16} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Flex>
          );
        })}
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
              <PiPlusBold className="mr-1" />
              Add another condition
            </Text>
          </Link>
        </Box>
      </Box>
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
