import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import useApi from "@/hooks/useApi";

export type QaOverrideSdkConnection = Pick<
  SDKConnectionInterface,
  "id" | "name" | "environment" | "projects" | "key" | "languages"
>;

export default function useExperimentQaOverrides(
  experimentId: string | undefined,
) {
  return useApi<{
    overrides: ExperimentQaOverrideInterface[];
    sdkConnections: QaOverrideSdkConnection[];
  }>(`/qa-overrides/experiment/${experimentId}`, {
    shouldRun: () => !!experimentId,
  });
}
