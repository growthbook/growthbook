import { SavedGroupTargeting } from "shared/types/feature";
import { PiArrowSquareOut, PiPlusCircleBold } from "react-icons/pi";
import React from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
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
  ConditionGroupCard,
  ConditionGroupHeader,
  ConditionGroupContent,
  AndSeparator,
  AddConditionButton,
  AddConditionButtonWrap,
} from "./ConditionGroup";

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
    <Box my="4">
      <label>Target by Saved Groups</label>
      <Box mb="2">
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
      <ConditionGroupCard>
        <ConditionGroupHeader
          targetingType="group"
          total={value.length}
        />
        <ConditionGroupContent>
          {value.map((v, i) => (
            <Box key={i}>
              {i > 0 && <AndSeparator />}
              <Flex gap="2" align="start" px="0" py="2" style={{ minWidth: 0 }}>
                <Box style={{ flex: "0 0 25%", minWidth: 0, maxWidth: 200 }}>
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
                      { value: "any", label: "Any of" },
                      { value: "all", label: "All of" },
                      { value: "none", label: "None of" },
                    ]}
                  />
                </Box>
                <Box style={{ flex: 1, minWidth: 0 }}>
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
            </Box>
          ))}
          <AddConditionButtonWrap>
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
              Add group
            </AddConditionButton>
          </AddConditionButtonWrap>
        </ConditionGroupContent>
      </ConditionGroupCard>
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
