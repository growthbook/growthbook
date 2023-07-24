import React, { FC, useCallback, useMemo, useState } from "react";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { AppFeatures } from "@/types/app-features";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";

type DemoDataSourceGlobalBannerProps = {
  ready: boolean;
  currentProjectIsDemo: boolean;
};

export const DemoDataSourceGlobalBanner: FC<DemoDataSourceGlobalBannerProps> = ({
  ready,
  currentProjectIsDemo,
}) => {
  const [show, setShow] = useState(false);

  const onClick = useCallback(() => {
    setShow(!show);
  }, [show]);

  if (!ready || !currentProjectIsDemo) {
    return null;
  }

  return (
    <div className="demo-datasource-banner__wrapper">
      <div className="demo-datasource-banner">
        <div className="demo-datasource-banner__line" />

        {show && (
          <div
            className="demo-datasource-banner__tooltip-click-overlay"
            onClick={onClick}
          />
        )}

        <div className="demo-datasource-banner__text-wrapper">
          <button className="demo-datasource-banner__text" onClick={onClick}>
            Demo Project
          </button>
        </div>

        {show && (
          <>
            <SimpleTooltip position="bottom">
              <div className="text-left">
                <p>
                  This project lets you explore GrowthBook with sample data.
                  We&apos;ve created everything for you - a data source,
                  metrics, and experiments.
                </p>
                <p className="mb-0">
                  Once you are done exploring, you can delete this project and
                  create your own under Settings.
                </p>
              </div>
            </SimpleTooltip>
          </>
        )}
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
