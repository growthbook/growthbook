import React, { useState, useEffect } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import Tab from "../Tabs/Tab";
import ControlledTabs from "../Tabs/ControlledTabs";
import ExperimentsGetStarted from "./ExperimentsGetStarted";
import FeaturesGetStarted from "./FeaturesGetStarted";

export interface Props {
  onboardingType: "features" | "experiments";
  experiments: ExperimentInterfaceStringDates[];
  features: FeatureInterface[];
  mutateExperiments: () => void;
}

export default function GetStarted({
  onboardingType,
  experiments,
  features,
  mutateExperiments,
}: Props) {
  const [tab, setTab] = useState("features");

  useEffect(() => {
    setTab(onboardingType);
  }, [onboardingType]);

  return (
    <div className="getstarted">
      <div className="mb-3">
        <h1>Let&apos;s get started!</h1>
        <p className="mb-0">Follow the steps below to start using GrowthBook</p>
      </div>
      <ControlledTabs
        setActive={setTab}
        active={tab}
        defaultTab="features"
        newStyle={true}
      >
        <Tab display="Feature Flags" id="features" padding={false}>
          <FeaturesGetStarted features={features} />
        </Tab>
        <Tab display="Experiment Analysis" id="experiments" padding={false}>
          <ExperimentsGetStarted
            experiments={experiments}
            mutate={mutateExperiments}
          />
        </Tab>
      </ControlledTabs>
    </div>
  );
}
