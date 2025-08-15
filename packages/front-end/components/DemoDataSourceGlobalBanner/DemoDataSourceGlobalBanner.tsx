import React, { FC, useMemo } from "react";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { AppFeatures } from "@/types/app-features";

type DemoDataSourceGlobalBannerProps = {
  ready: boolean;
  currentProjectIsDemo: boolean;
  onDemoPage?: boolean;
};

export const DemoDataSourceGlobalBanner: FC<
  DemoDataSourceGlobalBannerProps
> = ({ ready, currentProjectIsDemo, onDemoPage }) => {
  if (!ready || !currentProjectIsDemo) {
    return null;
  }

  return (
    <div className="demo-datasource-banner__wrapper">
      <div className="demo-datasource-banner">
        <div className="demo-datasource-banner__line" />

        <div className="demo-datasource-banner__text-wrapper">
          {onDemoPage ? (
            <span className="demo-datasource-banner__text">Demo Project</span>
          ) : (
            <Link
              href="/demo-datasource-project"
              className="demo-datasource-banner__text text-white"
            >
              Demo Project
            </Link>
          )}
        </div>
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

  const router = useRouter();
  const onDemoPage = router.pathname === "/demo-datasource-project";

  return (
    <DemoDataSourceGlobalBanner
      ready={ready}
      currentProjectIsDemo={currentProjectIsDemo}
      onDemoPage={onDemoPage}
    />
  );
};
