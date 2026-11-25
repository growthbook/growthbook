import { useMemo } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import { QaOverrideNameLookups } from "@/services/qaOverrides";
import { operatorToText } from "@/components/Features/ConditionDisplay";

export default function useQaOverrideNameLookups(
  connections?: { id: string; name: string }[],
): QaOverrideNameLookups {
  const { getSavedGroupById, getProjectById } = useDefinitions();
  const { data: connectionData } = useSDKConnections();
  return useMemo(
    () => ({
      savedGroupName: (id) => getSavedGroupById(id)?.groupName ?? id,
      projectName: (id) => getProjectById(id)?.name ?? id,
      sdkConnectionName: (id) =>
        connections?.find((c) => c.id === id)?.name ??
        connectionData?.connections?.find((c) => c.id === id)?.name ??
        id,
      operatorText: (operator) => operatorToText({ operator }),
    }),
    [connections, connectionData, getProjectById, getSavedGroupById],
  );
}
