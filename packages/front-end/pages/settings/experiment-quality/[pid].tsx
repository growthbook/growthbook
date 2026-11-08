import React from "react";
import { useRouter } from "next/router";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { SettingsNoAccess } from "@/components/Layout/SettingsPage";
import ProjectOverridePage from "@/components/Settings/ExperimentQuality/ProjectOverridePage";

const ExperimentQualityProjectPage: React.FC = () => {
  const router = useRouter();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { pid, from } = router.query;
  if (typeof pid !== "string") return null;

  if (
    !hasCommercialFeature("experiment-quality-score") ||
    !permissionsUtil.canUpdateProject(pid)
  ) {
    return <SettingsNoAccess title="Experiment Quality" />;
  }

  return (
    <ProjectOverridePage
      key={pid}
      projectId={pid}
      copyFrom={typeof from === "string" ? from : null}
    />
  );
};

export default ExperimentQualityProjectPage;
