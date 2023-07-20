import React, { FC, useMemo } from "react";
import { FaExclamationCircle } from "react-icons/fa";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { AppFeatures } from "@/types/app-features";

type DemoDataSourceGlobalBannerProps = {
  ready: boolean;
  currentProjectIsDemo: boolean;
};

export const DemoDataSourceGlobalBanner: FC<DemoDataSourceGlobalBannerProps> = ({
  ready,
  currentProjectIsDemo,
}) => {
  if (!ready || !currentProjectIsDemo) {
    return null;
  }

  return (
    <div className="contents pagecontents container mb-3">
      <div className="alert alert-warning">
        <p className="font-weight-bold">
          <FaExclamationCircle /> Demo Datasource Project
        </p>
        <p>
          You are currently in the demo datasource project. There are some
          restrictions when creating resources linked to this project.
        </p>
        <p>
          All created resources will be deleted when the project is deleted.
        </p>
        <p>
          If you accidentally delete something in the demo project and would
          like to restore it, you can delete the whole project and recreate it.
        </p>
      </div>
    </div>
  );
};

export const DemoDataSourceGlobalBannerContainer = () => {
  const { orgId } = useAuth();
  const { project, ready } = useDefinitions();
  const isEnabled = useFeatureIsOn<AppFeatures>("demo-datasource");

  const currentProjectIsDemo = useMemo(() => {
    if (!isEnabled) return false;
    if (!orgId) return false;

    return project === getDemoDatasourceProjectIdForOrganization(orgId);
  }, [project, orgId, isEnabled]);

  return (
    <DemoDataSourceGlobalBanner
      ready={ready}
      currentProjectIsDemo={currentProjectIsDemo}
    />
  );
};
