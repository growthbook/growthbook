import React, { FC } from "react";
import { ImportFromServiceCard } from "@/components/importing/ImportFromServiceCard/ImportFromServiceCard";

type ImportYourDataProps = Record<string, never>;

const supportedServices = [
  {
    service: "LaunchDarkly",
    icon: "launchdarkly",
    path: "launchdarkly",
    accentColor: "#000",
    text: "Import your projects, features and environments from LaunchDarkly.",
  },
  {
    service: "Statsig",
    icon: "statsig",
    path: "statsig",
    accentColor: "#000",
    text: "Import your projects, features, environments, and metrics from Statsig.",
  },
];

export const ImportYourData: FC<ImportYourDataProps> = (_props) => {
  return (
    <div>
      <h1>Import your data</h1>

      {supportedServices.map(({ service, icon, path, accentColor, text }) => (
        <div key={`ImportFromServiceCard-${service}`} className="my-3">
          <ImportFromServiceCard
            service={service}
            icon={icon}
            path={path}
            accentColor={accentColor}
          >
            {text}
          </ImportFromServiceCard>
        </div>
      ))}
    </div>
  );
};
