import React from "react";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import MetricsList from "@/components/Metrics/MetricsList";
import MetricGroupsList from "@/components/Metrics/MetricGroupsList";
import { useUser } from "@/services/UserContext";
import { GBPremiumBadge } from "@/components/Icons";

const MetricsPage = (): React.ReactElement => {
  const { hasCommercialFeature } = useUser();
  const hasGroupsFeature = hasCommercialFeature("metric-groups");
  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      <Tabs defaultTab="metrics" newStyle={true}>
        <Tab anchor="metrics" id="metrics" display="Metrics" padding={false}>
          <MetricsList />
        </Tab>
        <Tab
          anchor="metricgroups"
          id="metricgroups"
          display={
            <>{!hasGroupsFeature ? <GBPremiumBadge /> : ""} Metric Groups</>
          }
          padding={false}
          lazy
        >
          <MetricGroupsList />
        </Tab>
      </Tabs>
    </div>
  );
};

export default MetricsPage;
