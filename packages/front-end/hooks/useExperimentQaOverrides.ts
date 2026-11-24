import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import useApi from "@/hooks/useApi";

export type QaOverrideSdkConnection = Pick<
  SDKConnectionInterface,
  "id" | "name"
>;

type QaOverridesExperiment = {
  id: string;
  status: string;
  archived?: boolean;
};

// Overrides only exist while the experiment is a draft.
export default function useExperimentQaOverrides(
  experiment: QaOverridesExperiment,
) {
  const active = experiment.status === "draft" && !experiment.archived;
  const response = useApi<{
    overrides: ExperimentQaOverrideWithStatus[];
    sdkConnections: QaOverrideSdkConnection[];
  }>(`/qa-overrides/experiment/${experiment.id}`, {
    shouldRun: () => active,
  });
  return active ? response : { ...response, data: undefined };
}

export function useQaOverrideCount(experiment: QaOverridesExperiment): number {
  return useExperimentQaOverrides(experiment).data?.overrides.length ?? 0;
}
