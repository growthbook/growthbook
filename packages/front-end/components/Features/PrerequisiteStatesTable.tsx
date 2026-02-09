import React from "react";
import { Box } from "@radix-ui/themes";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { getFeatureDefaultValue } from "@/services/features";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
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
      <Box style={{ maxWidth: "100%", overflowX: "auto" }}>
        <table className="table table-sm border mb-0">
          <thead className="text-dark">
            <tr>
              <th className="pl-4">Type</th>
              <th className="border-right" style={{ minWidth: 120 }}>
                Default value
              </th>
              {environments.map((env) => (
                <th key={env} className="text-center">
                  <OverflowText maxWidth={100}>{env}</OverflowText>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pl-4">
                {parentFeature.valueType === "json"
                  ? "JSON"
                  : parentFeature.valueType}
              </td>
              <td className="border-right" style={{ maxWidth: 400 }}>
                <ValueDisplay
                  value={getFeatureDefaultValue(parentFeature)}
                  type={parentFeature.valueType}
                  fullStyle={{
                    maxHeight: 80,
                    overflowY: "auto",
                    overflowX: "auto",
                    maxWidth: "100%",
                  }}
                />
              </td>
              <PrerequisiteStatesCols
                prereqStates={prereqStates ?? undefined}
                envs={environments}
                loading={loading}
              />
            </tr>
          </tbody>
        </table>
      </Box>
    </Box>
  );
}
