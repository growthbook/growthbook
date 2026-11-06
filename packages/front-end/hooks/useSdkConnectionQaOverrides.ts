import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import useApi from "@/hooks/useApi";

export type QaOverrideExperiment = Pick<
  ExperimentInterfaceStringDates,
  | "id"
  | "name"
  | "status"
  | "trackingKey"
  | "variations"
  | "phases"
  | "type"
  | "project"
  | "hashAttribute"
>;

export default function useSdkConnectionQaOverrides(
  sdkConnectionId: string | undefined,
) {
  return useApi<{
    overrides: ExperimentQaOverrideInterface[];
    experiments: QaOverrideExperiment[];
  }>(`/qa-overrides/sdk-connection/${sdkConnectionId}`, {
    shouldRun: () => !!sdkConnectionId,
  });
}
