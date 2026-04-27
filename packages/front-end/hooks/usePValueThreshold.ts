import { DEFAULT_P_VALUE_THRESHOLD } from "shared/constants";
import { getScopedSettings } from "shared/settings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function usePValueThreshold(projectId: string | undefined) {
  const { organization } = useUser();
  const { getProjectById } = useDefinitions();
  const project =
    projectId && projectId.length > 0
      ? (getProjectById(projectId) ?? undefined)
      : undefined;
  const { settings } = getScopedSettings({ organization, project });
  return settings.pValueThreshold.value || DEFAULT_P_VALUE_THRESHOLD;
}
