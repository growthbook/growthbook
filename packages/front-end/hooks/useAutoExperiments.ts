import { useCallback } from "react";
import {
  getAutoExperimentParentFeature,
  isAutoExperimentFeatureEnabled,
} from "shared/util";
import type { AutoExperimentFeature } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import { getAutoExperimentsMode } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

// Why nothing can be turned on when the instance doesn't allow it.
export const AUTO_EXPERIMENTS_ENV_HINT =
  "Set the ALLOW_AUTO_EXPERIMENTS environment variable to true to allow enabling this";

// The organization's opt-ins for visual editor and URL redirect experiments.
export default function useAutoExperiments() {
  const { settings, refreshOrganization } = useUser();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const mode = getAutoExperimentsMode();

  const isEnabled = useCallback(
    (feature: AutoExperimentFeature) =>
      isAutoExperimentFeatureEnabled(settings, feature, mode),
    [settings, mode],
  );

  const setEnabled = useCallback(
    async (feature: AutoExperimentFeature, enabled: boolean) => {
      const parent = getAutoExperimentParentFeature(feature);
      await apiCall("/organization", {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            autoExperiments: {
              [feature]: enabled,
              ...(enabled && parent ? { [parent]: true } : {}),
            },
          },
        }),
      });
      await refreshOrganization();
    },
    [apiCall, refreshOrganization],
  );

  return {
    mode,
    isEnabled,
    setEnabled,
    canManage: permissionsUtil.canManageOrgSettings(),
  };
}
