import React from "react";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import MetricsList from "@/components/Metrics/MetricsList";
import MetricGroupsList from "@/components/Metrics/MetricGroupsList";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

const MetricsPage = (): React.ReactElement => {
  return (
    <div className="container-fluid pagecontents">
      <Tabs defaultTab="metrics" newStyle={true}>
        <Tab anchor="metrics" id="metrics" display="Metrics" padding={false}>
          <MetricsList />
        </Tab>
        <Tab
          anchor="metricgroups"
          id="metricgroups"
          display={
            <PremiumTooltip commercialFeature="metric-groups">
              Metric Groups
            </PremiumTooltip>
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
