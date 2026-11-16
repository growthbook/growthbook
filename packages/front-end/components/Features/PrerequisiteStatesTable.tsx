import React from "react";
import { Box } from "@radix-ui/themes";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { getFeatureDefaultValue } from "@/services/features";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import PrerequisiteTable from "@/components/Features/PrerequisiteTable";
import Text from "@/ui/Text";
import { PrerequisiteStateResult } from "@/hooks/usePrerequisiteStates";

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

  return (
    <Box mt="1" mb="3">
      <PrerequisiteTable
        showDetails
        nameWidth={180}
        environments={environments}
        rows={[
          {
            key: parentFeature.id,
            name: (
              <Text weight="medium" truncate>
                {parentFeature.id}
              </Text>
            ),
            details: {
              valueType: parentFeature.valueType,
              defaultValue: (
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
              ),
            },
            state: (env) => (
              <PrerequisiteStatesCols
                prereqStates={prereqStates ?? undefined}
                envs={[env]}
                loading={loading}
                colWidth={20}
                compact
                usePortal
              />
            ),
          },
        ]}
      />
    </Box>
  );
}
