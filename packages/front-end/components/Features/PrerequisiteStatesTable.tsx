import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { getFeatureDefaultValue } from "@/services/features";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Text from "@/ui/Text";
import { PrerequisiteStateResult } from "@/hooks/usePrerequisiteStates";

const TYPE_W = 100;
const DEFAULT_W = 200;
const COL_W = 100;

export interface MinimalFeatureInfo {
  id?: string;
  valueType: "boolean" | "string" | "number" | "json";
  project?: string;
  defaultValue?: string;
}

interface Props {
  parentFeature?: MinimalFeatureInfo;
  prereqStates: Record<string, PrerequisiteStateResult> | null;
  environments: string[];
  loading?: boolean;
}

export default function PrerequisiteStatesTable({
  parentFeature,
  prereqStates,
  environments,
  loading = false,
}: Props) {
  if (!parentFeature || !parentFeature.id) {
    return null;
  }

  const valueType =
    parentFeature.valueType === "json" ? "JSON" : parentFeature.valueType;

  return (
    <Box mt="1" mb="3" style={{ overflowX: "auto" }}>
      <Flex direction="column" style={{ minWidth: "max-content" }}>
        {/* Header row */}
        <Flex align="center" pb="1">
          <Box style={{ width: TYPE_W, flexShrink: 0 }}>
            <Text weight="semibold" color="text-mid">
              Type
            </Text>
          </Box>
          <Box style={{ width: DEFAULT_W, flexShrink: 0 }}>
            <Text weight="semibold" color="text-mid">
              Default value
            </Text>
          </Box>
          {environments.map((env) => (
            <Box
              key={env}
              style={{ width: COL_W, flexShrink: 0, textAlign: "center" }}
            >
              <Text weight="semibold" color="text-mid">
                <OverflowText maxWidth={COL_W}>{env}</OverflowText>
              </Text>
            </Box>
          ))}
        </Flex>

        {/* Data row */}
        <Flex align="center" style={{ borderTop: "1px solid var(--gray-4)" }}>
          <Box style={{ width: TYPE_W, flexShrink: 0 }} py="2">
            <Text color="text-mid">{valueType}</Text>
          </Box>
          <Box
            style={{ width: DEFAULT_W, flexShrink: 0, overflow: "hidden" }}
            py="2"
          >
            <ValueDisplay
              value={getFeatureDefaultValue(parentFeature)}
              type={parentFeature.valueType}
              fullStyle={{
                maxHeight: 60,
                overflowY: "auto",
                overflowX: "auto",
                maxWidth: "100%",
              }}
            />
          </Box>
          <PrerequisiteStatesCols
            prereqStates={prereqStates ?? undefined}
            envs={environments}
            loading={loading}
            colWidth={COL_W}
          />
        </Flex>
      </Flex>
    </Box>
  );
}
