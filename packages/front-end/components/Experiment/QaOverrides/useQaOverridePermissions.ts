import { useMemo } from "react";
import { isProductionEnvironment } from "shared/util";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export default function useQaOverridePermissions(experiment: {
  project?: string;
}) {
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();
  return useMemo(() => {
    const canEditIn = (environment: string) =>
      permissionsUtil.canRunExperiment(experiment, [environment]);
    const eligibleEnvironments = environments.filter(
      (e) => !isProductionEnvironment(e),
    );
    return {
      environments,
      environmentOrder: environments.map((e) => e.id),
      eligibleEnvironments,
      canEditIn,
      canAdd: eligibleEnvironments.some((e) => canEditIn(e.id)),
    };
  }, [environments, experiment, permissionsUtil]);
}
